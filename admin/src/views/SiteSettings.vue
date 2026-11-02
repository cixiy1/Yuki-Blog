<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AppIcon from "../components/AppIcon.vue";
import PageHeader from "../components/PageHeader.vue";
import {
	applyHot,
	type ConfigVersion,
	loadSecrets,
	loadSettings,
	publishDraft,
	rollbackTo,
	type SecretStatus,
	saveDraft,
	saveSecret,
} from "../lib/settings";
import {
	ALL_FIELDS,
	type ConfigNamespace,
	flattenDiff,
	readField,
	SETTING_GROUPS,
	type SettingField,
	type SettingSection,
	writePath,
} from "../lib/settings-schema";

type Plain = Record<string, unknown>;

const SECRET_LABELS: Record<string, string> = {
	github_token: "GitHub 令牌（发布配置用）",
	github_client_secret: "GitHub OAuth Secret",
	resend_api_key: "Resend API Key（发信）",
};

const SECRET_HELP: Record<string, string> = {
	github_token:
		"fine-grained PAT，只勾 cixiy1/Yuki-blog 的 Contents 读写。填了才能一键发布。",
	github_client_secret: "GitHub OAuth App 的 Client Secret，用于第三方登录。",
	resend_api_key: "注册验证邮件与找回密码邮件靠它发出。",
};

const tabs = [
	...SETTING_GROUPS.map((g) => ({ key: g.key, label: g.label })),
	{ key: "integrations", label: "集成" },
];

const tab = ref("basic");
const loading = ref(true);
const errorText = ref("");
const notice = ref("");
const busy = ref(false);

/** 整份配置文档（按命名空间分段），表单、草稿、已发布都是这个形状 */
const form = ref<Plain>({});
const draft0 = ref<Plain>({});
const published = ref<Plain>({});
const versions = ref<ConfigVersion[]>([]);
const secrets = ref<SecretStatus[]>([]);
const secretInput = ref<Record<string, string>>({});
const tagInput = ref<Record<string, string>>({});

const group = computed(() => SETTING_GROUPS.find((g) => g.key === tab.value));

const unsaved = computed(
	() =>
		JSON.stringify(sortKeys(form.value)) !==
		JSON.stringify(sortKeys(draft0.value)),
);
const pending = computed(() => flattenDiff(form.value, published.value));

const changedFields = computed(() =>
	ALL_FIELDS.filter(
		(field) =>
			JSON.stringify(readField(form.value, field.namespace, field.path)) !==
			JSON.stringify(readField(draft0.value, field.namespace, field.path)),
	),
);
const changedAllHot = computed(
	() =>
		changedFields.value.length > 0 && changedFields.value.every((f) => f.hot),
);
/** 热字段的完整路径，用来判断「待发布」里有没有能跳过构建的项 */
const hotPaths = new Set(
	ALL_FIELDS.filter((f) => f.hot).map((f) => `${f.namespace}.${f.path}`),
);

/**
 * 有热字段已保存但还没「立即应用」。
 * 判据要看「表单 vs 已发布」，不能看「表单 vs 草稿」——保存之后后者恒为空，
 * 按钮会立刻消失，用户再也点不到。
 */
const hotPending = computed(() =>
	pending.value.some((item) => hotPaths.has(item.path)),
);

/** 浅递归合并：用于「默认值 ← 已发布 ← 草稿」三层叠加 */
function merge<T>(base: unknown, patch: unknown): T {
	if (Array.isArray(base) || Array.isArray(patch)) return (patch ?? base) as T;
	if (!base || typeof base !== "object") return (patch ?? base) as T;
	if (!patch || typeof patch !== "object") return base as T;
	const out: Plain = { ...(base as Plain) };
	for (const [key, value] of Object.entries(patch as Plain)) {
		out[key] = merge((base as Plain)[key], value);
	}
	return out as T;
}

/** Vue 的响应式对象不能直接 structuredClone（会抛 DataCloneError），走一次 JSON 往返 */
function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value).sort()) {
			out[key] = sortKeys((value as Plain)[key]);
		}
		return out;
	}
	return value;
}

/** 字段在表单里的当前值；namespace 决定去哪个分区取 */
function fieldValue(field: SettingField, ns: ConfigNamespace): unknown {
	const raw = readField(form.value, ns, field.path);
	if (field.type === "tags") return Array.isArray(raw) ? raw : [];
	if (field.type === "list") return Array.isArray(raw) ? raw : [];
	return raw;
}

function asText(field: SettingField, ns: ConfigNamespace): string {
	const value = fieldValue(field, ns);
	if (Array.isArray(value)) return value.join("\n");
	return value === undefined || value === null ? "" : String(value);
}

function asNumber(field: SettingField, ns: ConfigNamespace): number {
	const value = Number(fieldValue(field, ns));
	return Number.isFinite(value) ? value : (field.min ?? 0);
}

function slotKey(ns: ConfigNamespace, field: SettingField): string {
	return `${ns}.${field.path}`;
}

function set(field: SettingField, ns: ConfigNamespace, value: unknown): void {
	const section = (form.value[ns] as Plain | undefined) ?? {};
	writePath(section, field.path, value);
	form.value[ns] = section;
	notice.value = "";
}

function setText(field: SettingField, ns: ConfigNamespace, event: Event): void {
	const raw = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
	const numeric = field.type === "number" || field.type === "hue";
	set(field, ns, numeric ? Number(raw) : raw);
}

function addTag(field: SettingField, ns: ConfigNamespace): void {
	const key = slotKey(ns, field);
	const text = (tagInput.value[key] ?? "").trim();
	if (!text) return;
	const list = [...(fieldValue(field, ns) as string[])];
	if (!list.includes(text)) list.push(text);
	set(field, ns, list);
	tagInput.value[key] = "";
}

function removeTag(
	field: SettingField,
	ns: ConfigNamespace,
	tag: string,
): void {
	const list = (fieldValue(field, ns) as string[]).filter(
		(item) => item !== tag,
	);
	set(field, ns, list);
}

/** 列表型字段：行是最小编辑单元，支持加/删/上下移动 */
function listRows(field: SettingField, ns: ConfigNamespace): Plain[] {
	return fieldValue(field, ns) as Plain[];
}

function blankRow(field: SettingField): Plain {
	const row: Plain = {};
	for (const item of field.itemFields ?? []) {
		row[item.path] =
			item.type === "switch"
				? false
				: item.type === "number"
					? (item.min ?? 0)
					: "";
	}
	return row;
}

function addRow(field: SettingField, ns: ConfigNamespace): void {
	set(field, ns, [...listRows(field, ns), blankRow(field)]);
}

function removeRow(
	field: SettingField,
	ns: ConfigNamespace,
	index: number,
): void {
	const rows = [...listRows(field, ns)];
	rows.splice(index, 1);
	set(field, ns, rows);
}

function moveRow(
	field: SettingField,
	ns: ConfigNamespace,
	index: number,
	delta: number,
): void {
	const rows = [...listRows(field, ns)];
	const target = index + delta;
	if (target < 0 || target >= rows.length) return;
	[rows[index], rows[target]] = [rows[target], rows[index]];
	set(field, ns, rows);
}

function setCell(
	field: SettingField,
	ns: ConfigNamespace,
	index: number,
	key: string,
	value: unknown,
): void {
	const rows = clone(listRows(field, ns));
	if (!rows[index]) return;
	rows[index][key] = value;
	set(field, ns, rows);
}

function rowTitle(field: SettingField, row: Plain, index: number): string {
	const raw = field.itemTitle ? row[field.itemTitle] : "";
	const text = typeof raw === "string" ? raw.trim() : "";
	return text || `第 ${index + 1} 项`;
}

function hueColor(hue: number): string {
	return `oklch(0.7 0.14 ${hue})`;
}

async function refresh(): Promise<void> {
	loading.value = true;
	errorText.value = "";
	try {
		const [data, defaults] = await Promise.all([
			loadSettings(),
			fetch("/site-defaults.json")
				.then((res) => (res.ok ? res.json() : {}))
				.catch(() => ({})),
		]);
		// 已发布值 = 构建时的默认值 + 上次发布的内容；表单 = 再叠上未发布的草稿
		//
		// 两层都要 clone：merge 只做浅拷贝，padding 为空的子对象会和 base 共享引用，
		// 于是「改表单」等于「改已发布值」，差异恒为 0，发布按钮永远灰着。
		const effective = merge<Plain>(defaults, data.published);
		published.value = clone(effective);
		form.value = clone(merge<Plain>(effective, data.draft));
		draft0.value = clone(form.value);
		versions.value = data.versions;
		secrets.value = await loadSecrets();
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "读取失败";
	} finally {
		loading.value = false;
	}
}

async function onSave(): Promise<void> {
	busy.value = true;
	notice.value = "";
	errorText.value = "";
	try {
		// 只提交改过的字段：整份文档里有大量默认值，发过去会被服务端原样存下，
		// 以后默认值变了也盖不住
		await saveDraft(collectPatch());
		draft0.value = clone(form.value);
		notice.value = "草稿已保存。带绿点的字段可用「立即应用」，其余需要发布。";
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "保存失败";
	} finally {
		busy.value = false;
	}
}

/** 与已发布值不同的字段，按命名空间拼回一份补丁文档 */
function collectPatch(): Plain {
	const patch: Plain = {};
	for (const item of pending.value) {
		const [ns, ...rest] = item.path.split(".");
		const section = (patch[ns] as Plain | undefined) ?? {};
		writePath(section, rest.join("."), item.after);
		patch[ns] = section;
	}
	return patch;
}

async function onApplyHot(): Promise<void> {
	busy.value = true;
	notice.value = "";
	errorText.value = "";
	try {
		const result = await applyHot();
		notice.value = result.message ?? "已生效";
		await refresh();
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "应用失败";
	} finally {
		busy.value = false;
	}
}

async function onPublish(): Promise<void> {
	if (unsaved.value) {
		notice.value = "还有未保存的改动，先保存草稿再发布。";
		return;
	}
	busy.value = true;
	errorText.value = "";
	try {
		const result = await publishDraft("chore(site): 更新站点配置");
		notice.value = result.message ?? "已提交";
		await refresh();
	} catch (error) {
		const message = error instanceof Error ? error.message : "发布失败";
		errorText.value = message.includes("GitHub 令牌")
			? `${message}（在「集成」页填好后重试）`
			: message;
	} finally {
		busy.value = false;
	}
}

async function onRollback(version: ConfigVersion): Promise<void> {
	if (
		!confirm(`把配置回滚到 ${version.published_at} 那一版？会覆盖当前草稿。`)
	) {
		return;
	}
	busy.value = true;
	try {
		const draft = await rollbackTo(version.id);
		if (draft) {
			draft0.value = clone(draft);
			form.value = clone(draft);
			notice.value = "已灌回草稿，确认无误后再发布。";
		}
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "回滚失败";
	} finally {
		busy.value = false;
	}
}

function exportJson(): void {
	// 只导补丁，不导整份文档：整份会把所有默认值固化进仓库，
	// 以后改 src/config 的默认值就再也盖不动了
	const doc = {
		_comment:
			"管理端「站点设置」发布时整体覆盖本文件。各分区留空即使用 src/config 里的默认值。分区：site / profile / music / friends / banner / announcement",
		...collectPatch(),
	};
	const blob = new Blob([`${JSON.stringify(doc, null, "\t")}\n`], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = "site.json";
	anchor.click();
	URL.revokeObjectURL(url);
	notice.value = "已导出 site.json，放到仓库 config/ 下提交即可生效。";
}

async function onSaveSecret(name: string): Promise<void> {
	const value = (secretInput.value[name] ?? "").trim();
	busy.value = true;
	try {
		secrets.value = await saveSecret(name, value);
		secretInput.value[name] = "";
		notice.value = value ? "已加密保存。" : "已清除该密钥。";
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "保存失败";
	} finally {
		busy.value = false;
	}
}

function showDiff(before: unknown): string {
	if (before === undefined || before === null) return "（空）";
	if (Array.isArray(before))
		return before.length ? `${before.length} 项` : "（空）";
	if (typeof before === "boolean") return before ? "开" : "关";
	return String(before);
}

function rowDirty(section: SettingSection, field: SettingField): boolean {
	return (
		JSON.stringify(readField(form.value, section.namespace, field.path)) !==
		JSON.stringify(readField(draft0.value, section.namespace, field.path))
	);
}

onMounted(() => void refresh());
</script>

<template>
	<div>
		<PageHeader
			title="站点设置"
			desc="改完先存草稿，确认无误再发布；发布约 90 秒后全站生效。"
		>
			<template #actions>
				<button type="button" class="btn-ghost" :disabled="busy" @click="exportJson">
					导出 JSON
				</button>
				<button
					type="button"
					class="btn-regular"
					:disabled="busy || !unsaved"
					@click="onSave"
				>
					保存草稿
				</button>
				<button
					type="button"
					class="btn-primary"
					:disabled="busy || !pending.length"
					@click="onPublish"
				>
					发布
					<span v-if="pending.length" class="pill">{{ pending.length }}</span>
				</button>
			</template>
		</PageHeader>

		<p v-if="errorText" class="error">{{ errorText }}</p>
		<p v-else-if="notice" class="notice">{{ notice }}</p>

		<nav class="tabs">
			<button
				v-for="item in tabs"
				:key="item.key"
				type="button"
				:class="['tab', { on: tab === item.key }]"
				@click="tab = item.key"
			>
				{{ item.label }}
			</button>
		</nav>

		<div v-if="loading" class="state">读取中…</div>

		<div v-else-if="tab === 'integrations'" class="card-base panel">
			<h3>密钥</h3>
			<p class="hint">
				加密后存进数据库，只回显末四位。清空输入框并保存即删除。这些值不会进仓库，也不会出现在任何日志与审计里。
			</p>
			<div v-for="secret in secrets" :key="secret.name" class="secret">
				<div class="secret-head">
					<strong>{{ SECRET_LABELS[secret.name] ?? secret.name }}</strong>
					<span :class="['tag', secret.configured ? 'ok' : 'off']">
						{{ secret.configured ? `已配置 ${secret.hint ?? ""}` : "未配置" }}
					</span>
				</div>
				<p class="hint">{{ SECRET_HELP[secret.name] }}</p>
				<div class="secret-row">
					<input
						v-model="secretInput[secret.name]"
						class="field"
						type="password"
						autocomplete="off"
						:placeholder="secret.configured ? '留空表示不修改' : '粘贴密钥'"
					/>
					<button
						type="button"
						class="btn-regular"
						:disabled="busy"
						@click="onSaveSecret(secret.name)"
					>
						保存
					</button>
				</div>
			</div>
		</div>

		<div v-else class="layout">
			<p v-if="group?.desc" class="group-desc">{{ group.desc }}</p>

			<section class="main">
				<div
					v-for="section in group?.sections ?? []"
					:key="section.title"
					class="card-base panel"
				>
					<h3>{{ section.title }}</h3>
					<p v-if="section.note" class="hint">{{ section.note }}</p>

					<div
						v-for="field in section.fields"
						:key="field.path"
						:class="['row', { stacked: field.type === 'list' }]"
					>
						<div class="label">
							<span class="name">
								{{ field.label }}
								<span v-if="field.hot" class="dot hot" title="保存后点「立即应用」即可生效" />
								<span v-else class="dot" title="需要发布并等构建完成" />
							</span>
							<span v-if="field.help" class="hint">{{ field.help }}</span>
						</div>

						<div class="control">
							<select
								v-if="field.type === 'select'"
								class="field"
								:value="asText(field, section.namespace)"
								@change="setText(field, section.namespace, $event)"
							>
								<option v-for="opt in field.options" :key="opt.value" :value="opt.value">
									{{ opt.label }}
								</option>
							</select>

							<textarea
								v-else-if="field.type === 'textarea'"
								class="field area"
								rows="3"
								:value="asText(field, section.namespace)"
								@input="setText(field, section.namespace, $event)"
							/>

							<input
								v-else-if="field.type === 'number'"
								class="field narrow"
								type="number"
								:min="field.min"
								:max="field.max"
								:step="field.step ?? 1"
								:value="asNumber(field, section.namespace)"
								@input="setText(field, section.namespace, $event)"
							/>

							<div v-else-if="field.type === 'switch'" class="switch-wrap">
								<button
									type="button"
									:class="['switch', { on: fieldValue(field, section.namespace) === true }]"
									@click="set(field, section.namespace, fieldValue(field, section.namespace) !== true)"
								>
									<span class="knob" />
								</button>
								<span class="switch-text">
									{{ fieldValue(field, section.namespace) === true ? "已开启" : "已关闭" }}
								</span>
							</div>

							<div v-else-if="field.type === 'hue'" class="hue-wrap">
								<input
									class="range"
									type="range"
									min="0"
									max="360"
									step="1"
									:value="asNumber(field, section.namespace)"
									@input="setText(field, section.namespace, $event)"
								/>
								<span
									class="swatch"
									:style="{ background: hueColor(asNumber(field, section.namespace)) }"
								/>
								<span class="hue-value">{{ asNumber(field, section.namespace) }}</span>
							</div>

							<div v-else-if="field.type === 'tags'" class="tags">
								<span
									v-for="tag in fieldValue(field, section.namespace) as string[]"
									:key="tag"
									class="tag"
								>
									{{ tag }}
									<button
										type="button"
										class="tag-x"
										@click="removeTag(field, section.namespace, tag)"
									>
										×
									</button>
								</span>
								<input
									v-model="tagInput[slotKey(section.namespace, field)]"
									class="field tag-input"
									:placeholder="field.placeholder ?? '输入后回车'"
									@keydown.enter.prevent="addTag(field, section.namespace)"
									@blur="addTag(field, section.namespace)"
								/>
							</div>

							<!-- 列表：每行一张小卡，行的标题取 itemTitle 那一列 -->
							<div v-else-if="field.type === 'list'" class="list">
								<p
									v-if="!listRows(field, section.namespace).length"
									class="hint empty"
								>
									{{ field.emptyText ?? "还没有内容" }}
								</p>
								<div
									v-for="(row, index) in listRows(field, section.namespace)"
									:key="index"
									class="list-row"
								>
									<div class="list-head">
										<span class="list-title">{{ rowTitle(field, row, index) }}</span>
										<div class="list-ops">
											<button
												type="button"
												class="op"
												title="上移"
												:disabled="index === 0"
												@click="moveRow(field, section.namespace, index, -1)"
											>
												↑
											</button>
											<button
												type="button"
												class="op"
												title="下移"
												:disabled="index === listRows(field, section.namespace).length - 1"
												@click="moveRow(field, section.namespace, index, 1)"
											>
												↓
											</button>
											<button
												type="button"
												class="op danger"
												title="删除这一行"
												@click="removeRow(field, section.namespace, index)"
											>
												删除
											</button>
										</div>
									</div>
									<div class="list-fields">
										<label
											v-for="item in field.itemFields"
											:key="item.path"
											class="cell"
										>
											<span class="cell-label">{{ item.label }}</span>
											<button
												v-if="item.type === 'switch'"
												type="button"
												:class="['switch', { on: row[item.path] === true }]"
												@click="setCell(field, section.namespace, index, item.path, row[item.path] !== true)"
											>
												<span class="knob" />
											</button>
											<input
												v-else
												class="field"
												:type="item.type === 'number' ? 'number' : 'text'"
												:min="item.min"
												:max="item.max"
												:placeholder="item.placeholder"
												:value="row[item.path] ?? ''"
												@input="setCell(field, section.namespace, index, item.path, item.type === 'number' ? Number(($event.target as HTMLInputElement).value) : ($event.target as HTMLInputElement).value)"
											/>
										</label>
									</div>
								</div>
								<button
									type="button"
									class="btn-regular add-row"
									@click="addRow(field, section.namespace)"
								>
									添加一行
								</button>
							</div>

							<input
								v-else
								class="field"
								type="text"
								:value="asText(field, section.namespace)"
								:placeholder="field.placeholder"
								@input="setText(field, section.namespace, $event)"
							/>

							<span v-if="field.danger" class="warn">改动影响全站，发布前确认</span>
							<span v-else-if="rowDirty(section, field)" class="dirty">未保存</span>
						</div>
					</div>
				</div>
			</section>

			<aside class="side">
				<div class="card-base panel">
					<h3>状态</h3>
					<dl class="facts">
						<div>
							<dt>未保存</dt>
							<dd :class="{ on: unsaved }">{{ unsaved ? `${changedFields.length} 处` : "无" }}</dd>
						</div>
						<div>
							<dt>待发布</dt>
							<dd :class="{ on: pending.length > 0 }">{{ pending.length }} 处</dd>
						</div>
					</dl>

					<button
						v-if="hotPending || changedAllHot"
						type="button"
						class="btn-regular full"
						:disabled="busy"
						@click="onApplyHot"
					>
						立即应用热字段
					</button>
					<p v-if="hotPending || changedAllHot" class="hint">
						只有带绿点的字段能跳过构建，目前是主题色相。
					</p>

					<template v-if="pending.length">
						<h4>待发布变更</h4>
						<ul class="diff">
							<li v-for="item in pending" :key="item.path">
								<span class="diff-label">{{ item.label }}</span>
								<span class="diff-value">
									{{ showDiff(item.before) }} → {{ showDiff(item.after) }}
								</span>
							</li>
						</ul>
					</template>
				</div>

				<div class="card-base panel">
					<h3>版本历史</h3>
					<p v-if="!versions.length" class="hint">还没有发布过。</p>
					<ul v-else class="versions">
						<li v-for="version in versions" :key="version.id">
							<div class="version-time">{{ version.published_at }}</div>
							<div class="version-note">
								{{ version.note ?? "（无说明）" }}
								<span v-if="!version.commit_sha" class="tag off">未落盘</span>
							</div>
							<button type="button" class="btn-ghost tiny" @click="onRollback(version)">
								回滚到此版本
							</button>
						</li>
					</ul>
				</div>
			</aside>
		</div>
	</div>
</template>

<style scoped>
.tabs {
	display: flex;
	gap: 0.2rem;
	overflow-x: auto;
	margin-bottom: 1.1rem;
	padding-bottom: 0.1rem;
	scrollbar-width: none;
}

.tabs::-webkit-scrollbar {
	display: none;
}

.tab {
	flex: 0 0 auto;
	border: none;
	background: transparent;
	padding: 0.42rem 0.75rem;
	border-radius: 999px;
	font-size: 0.82rem;
	color: var(--fg-50);
	cursor: pointer;
	white-space: nowrap;
	display: flex;
	align-items: center;
	gap: 0.3rem;
	transition:
		background-color 0.15s ease,
		color 0.15s ease;
}

.tab:hover {
	background: var(--btn-plain-bg-hover);
	color: var(--fg-90);
}

.tab.on {
	background: var(--tab-on-bg);
	color: var(--btn-content);
	font-weight: 600;
}

.group-desc {
	grid-column: 1 / -1;
	margin: 0 0 0.2rem;
	font-size: 0.78rem;
	color: var(--fg-50);
	line-height: 1.6;
}

.layout {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 17rem;
	gap: 0.9rem 1.25rem;
	align-items: start;
}

.layout > .side {
	position: sticky;
	top: calc(var(--nav-height) + 1rem);
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
}

.layout > .side .panel {
	margin-bottom: 0;
}

@media (max-width: 1100px) {
	.layout {
		grid-template-columns: minmax(0, 1fr);
	}

	.layout > .side {
		position: static;
	}
}

.panel {
	padding: 1.1rem 1.2rem;
	margin-bottom: 1rem;
}

.panel h3 {
	margin: 0 0 0.7rem;
	padding-bottom: 0.6rem;
	border-bottom: 1px solid var(--line-divider);
	font-size: 0.95rem;
	font-weight: 600;
	color: var(--fg-90);
}

.panel h4 {
	margin: 0.7rem 0 0.35rem;
	font-size: 0.78rem;
	color: var(--fg-75);
}

.hint {
	margin: 0.15rem 0 0;
	font-size: 0.73rem;
	color: var(--fg-50);
	line-height: 1.5;
}

.row {
	display: grid;
	grid-template-columns: 11rem minmax(0, 1fr);
	gap: 1rem;
	padding: 0.7rem 0;
	border-top: 1px solid var(--line-divider);
}

/* 列表型字段内容多，标签挪到上方整行显示 */
.row.stacked {
	grid-template-columns: minmax(0, 1fr);
	gap: 0.35rem;
}

.row:first-of-type {
	border-top: none;
}

@media (max-width: 820px) {
	.row {
		grid-template-columns: minmax(0, 1fr);
		gap: 0.4rem;
	}
}

.label .name {
	display: flex;
	align-items: center;
	gap: 0.35rem;
	font-size: 0.82rem;
	color: var(--fg-90);
}

.dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--line-color);
}

.dot.hot {
	background: var(--primary);
}

.control {
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
}

.area {
	resize: vertical;
	min-height: 4.2rem;
	line-height: 1.5;
}

.narrow {
	max-width: 9rem;
}

.switch-wrap {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.switch {
	width: 2.4rem;
	height: 1.3rem;
	border-radius: 999px;
	border: none;
	background: var(--line-color);
	position: relative;
	cursor: pointer;
	transition: background 0.15s;
	flex: 0 0 auto;
}

.switch.on {
	background: var(--primary);
}

.knob {
	position: absolute;
	top: 2px;
	left: 2px;
	width: calc(1.3rem - 4px);
	height: calc(1.3rem - 4px);
	border-radius: 50%;
	background: white;
	transition: transform 0.15s;
}

.switch.on .knob {
	transform: translateX(1.1rem);
}

.switch-text {
	font-size: 0.75rem;
	color: var(--fg-50);
}

.hue-wrap {
	display: flex;
	align-items: center;
	gap: 0.6rem;
}

.range {
	flex: 1;
	max-width: 16rem;
	accent-color: var(--primary);
}

.swatch {
	width: 1.4rem;
	height: 1.4rem;
	border-radius: 0.4rem;
	border: 1px solid var(--line-divider);
}

.hue-value {
	font-size: 0.75rem;
	color: var(--fg-50);
	font-variant-numeric: tabular-nums;
}

.tags {
	display: flex;
	flex-wrap: wrap;
	gap: 0.3rem;
	align-items: center;
}

.tag {
	font-size: 0.72rem;
	padding: 0.12rem 0.4rem;
	border-radius: 0.35rem;
	background: var(--btn-regular-bg);
	color: var(--btn-content);
	display: inline-flex;
	align-items: center;
	gap: 0.25rem;
}

.tag.ok {
	background: var(--btn-regular-bg);
}

.tag.off {
	background: var(--line-divider);
	color: var(--fg-50);
}

.tag-x {
	border: none;
	background: transparent;
	color: inherit;
	cursor: pointer;
	font-size: 0.8rem;
	line-height: 1;
	padding: 0;
}

.tag-input {
	max-width: 12rem;
}

/* —— 列表型字段 —— */
.list {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.list .empty {
	padding: 0.5rem 0;
}

.list-row {
	border: 1px solid var(--line-divider);
	border-radius: 0.55rem;
	padding: 0.5rem 0.6rem;
	background: var(--btn-plain-bg-hover);
}

.list-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
	margin-bottom: 0.45rem;
}

.list-title {
	font-size: 0.78rem;
	font-weight: 600;
	color: var(--fg-90);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.list-ops {
	display: flex;
	gap: 0.25rem;
	flex: 0 0 auto;
}

.op {
	border: 1px solid var(--line-divider);
	background: transparent;
	color: var(--fg-75);
	border-radius: 0.35rem;
	font-size: 0.7rem;
	padding: 0.1rem 0.35rem;
	cursor: pointer;
	line-height: 1.4;
}

.op:hover:not(:disabled) {
	background: var(--btn-regular-bg);
	color: var(--btn-content);
}

.op:disabled {
	opacity: 0.4;
	cursor: not-allowed;
}

.op.danger:hover {
	color: var(--admonitions-color-caution);
}

.list-fields {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
	gap: 0.4rem 0.6rem;
}

.cell {
	display: flex;
	flex-direction: column;
	gap: 0.2rem;
	min-width: 0;
}

.cell-label {
	font-size: 0.68rem;
	color: var(--fg-50);
}

.add-row {
	align-self: flex-start;
	font-size: 0.75rem;
	padding: 0.25rem 0.6rem;
}

.warn {
	font-size: 0.7rem;
	color: var(--admonitions-color-caution);
}

.dirty {
	font-size: 0.68rem;
	color: var(--primary);
}

.pill {
	margin-left: 0.35rem;
	font-size: 0.68rem;
	padding: 0 0.3rem;
	border-radius: 0.3rem;
	background: rgba(0, 0, 0, 0.18);
}

.btn-regular.full {
	width: 100%;
	margin-top: 0.5rem;
	font-size: 0.78rem;
	padding: 0.35rem 0.6rem;
}

.facts {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 0.5rem;
	margin: 0 0 0.35rem;
}

.facts dt {
	font-size: 0.72rem;
	color: var(--fg-50);
}

.facts dd {
	margin: 0.1rem 0 0;
	font-size: 0.9rem;
	color: var(--fg-90);
}

.facts dd.on {
	color: var(--btn-content);
	font-weight: 600;
}

.diff {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
}

.diff li {
	display: flex;
	justify-content: space-between;
	gap: 0.5rem;
	font-size: 0.74rem;
}

.diff-label {
	color: var(--fg-75);
	flex: 0 0 auto;
}

.diff-value {
	color: var(--fg-50);
	text-align: right;
	word-break: break-all;
}

.versions {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 0.55rem;
}

.versions li {
	border-top: 1px solid var(--line-divider);
	padding-top: 0.45rem;
}

.versions li:first-child {
	border-top: none;
	padding-top: 0;
}

.version-time {
	font-size: 0.72rem;
	color: var(--fg-50);
	font-variant-numeric: tabular-nums;
}

.version-note {
	font-size: 0.76rem;
	color: var(--fg-90);
	margin: 0.1rem 0 0.3rem;
}

.btn-ghost.tiny {
	font-size: 0.72rem;
	padding: 0.2rem 0.45rem;
}

.secret {
	border-top: 1px solid var(--line-divider);
	padding-top: 0.7rem;
	margin-top: 0.7rem;
}

.secret:first-of-type {
	border-top: none;
	margin-top: 0.2rem;
	padding-top: 0;
}

.secret-head {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	font-size: 0.85rem;
}

.secret-row {
	display: flex;
	gap: 0.4rem;
	margin-top: 0.4rem;
}

.secret-row .field {
	flex: 1;
}

.error {
	font-size: 0.8rem;
	color: var(--admonitions-color-caution);
	margin: 0 0 0.6rem;
}

.notice {
	font-size: 0.8rem;
	color: var(--btn-content);
	margin: 0 0 0.6rem;
}

.state {
	font-size: 0.85rem;
	color: var(--fg-50);
	padding: 1rem 0;
}
</style>
