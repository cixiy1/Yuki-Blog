<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AppIcon from "../components/AppIcon.vue";
import PageHeader from "../components/PageHeader.vue";
import WallpaperModePicker from "../components/WallpaperModePicker.vue";
import {
	applyHot,
	type ConfigVersion,
	loadMailConfig,
	loadSecrets,
	loadSettings,
	type MailConfig,
	type MailTestResult,
	publishDraft,
	rollbackTo,
	type SecretStatus,
	saveDraft,
	saveMailConfig,
	saveSecret,
	testMail,
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
	github_client_id: "Client ID",
	github_client_secret: "Client Secret",
	resend_api_key: "Resend API Key",
	smtp_pass: "SMTP 密码 / 授权码",
};

const SECRET_HELP: Record<string, string> = {
	github_token:
		"fine-grained PAT，只勾 cixiy1/Yuki-blog 的 Contents 读写。填了才能一键发布。",
	github_client_id:
		"OAuth App 页面上的 Client ID，不是密钥但容易和 Secret 弄混，一起放这。",
	github_client_secret:
		"OAuth App 页面上的 Client Secret，只在授权码换 token 时用，别发到前端。",
	resend_api_key:
		"Resend 后台生成的 Key，以 re_ 开头。需要先在 Resend 验证发件域名。",
	smtp_pass: "邮箱的 SMTP 授权码，不是登录密码。QQ / 163 都要单独生成。",
};

/** 三组密钥分别放在三张卡里，别混在一起 */
const GITHUB_LOGIN_SECRETS = ["github_client_id", "github_client_secret"];
const MAIL_SECRETS = ["resend_api_key", "smtp_pass"];
const PUBLISH_SECRETS = ["github_token"];

const tabs = [
	...SETTING_GROUPS.map((g) => ({
		key: g.key,
		label: g.label,
		desc: g.desc,
		icon: g.icon ?? "info",
		tone: g.tone ?? "var(--primary)",
	})),
	{
		key: "integrations",
		label: "集成",
		desc: "GitHub 登录、发信通道与发布令牌。密钥只进密钥库，任何接口都不回显。",
		icon: "plug",
		tone: "oklch(0.6 0.03 260)",
	},
];

const activeTab = computed(
	() => tabs.find((item) => item.key === tab.value) ?? tabs[0],
);

const tab = ref("basic");
const loading = ref(true);
const errorText = ref("");
const notice = ref("");
const busy = ref(false);

/** 整份配置文档（按命名空间分段），表单、草稿、已发布都是这个形状 */
const form = ref<Plain>({});
const draft0 = ref<Plain>({});
const published = ref<Plain>({});
/** 构建期默认值，用来决定「该把哪些字段写进草稿」 */
const defaults = ref<Plain>({});
/** 最近一次真正写进仓库的快照，用来判断「还有没有没落盘的改动」 */
const repoSnapshot = ref<Plain>({});
const versions = ref<ConfigVersion[]>([]);
const secrets = ref<SecretStatus[]>([]);
const secretInput = ref<Record<string, string>>({});
const tagInput = ref<Record<string, string>>({});

/* ---------- 发信配置 ---------- */
const mailConfig = ref<MailConfig>({
	mode: "off",
	from: "Yuki Blog <mail@yiyu14.top>",
	smtp: { host: "", port: 465, security: "ssl", user: "" },
});
const mailSource = ref<"db" | "env">("db");
const mailBusy = ref(false);
const mailTesting = ref(false);
const mailResult = ref<(MailTestResult & { failed?: boolean }) | null>(null);
/** OAuth 回调地址必须和 GitHub 上填的一字不差 */
const callbackUrl = ref("");

const group = computed(() => SETTING_GROUPS.find((g) => g.key === tab.value));

const unsaved = computed(
	() =>
		JSON.stringify(sortKeys(form.value)) !==
		JSON.stringify(sortKeys(draft0.value)),
);

/**
 * 「待发布」= 表单与**仓库快照**的差异，不能拿 `published` 当基准。
 *
 * `published` 会被「立即应用」提前改成最新值，比它的话热字段应用完就显示
 * 「待发布 0 处」，发布按钮直接变灰——仓库里其实还没有这份配置。
 */
const pending = computed(() => flattenDiff(form.value, repoSnapshot.value));

/** 表单 vs 已发布：只用来判断「热字段保存了但还没应用」 */
const savedPending = computed(() => flattenDiff(form.value, published.value));

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
	savedPending.value.some((item) => hotPaths.has(item.path)),
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
		const [data, defaultsDoc] = await Promise.all([
			loadSettings(),
			fetch("/site-defaults.json")
				.then((res) => (res.ok ? res.json() : {}))
				.catch(() => ({})),
		]);
		// 已发布值 = 构建时的默认值 + 上次发布的内容；表单 = 再叠上未发布的草稿
		//
		// 两层都要 clone：merge 只做浅拷贝，padding 为空的子对象会和 base 共享引用，
		// 于是「改表单」等于「改已发布值」，差异恒为 0，发布按钮永远灰着。
		const effective = merge<Plain>(defaultsDoc, data.published);
		published.value = clone(effective);
		form.value = clone(merge<Plain>(effective, data.draft));
		draft0.value = clone(form.value);
		defaults.value = clone(defaultsDoc);
		// 从没发布过就没有快照，拿默认值当基准：首次发布按钮要能点
		repoSnapshot.value = clone(
			data.repo ? merge<Plain>(defaultsDoc, data.repo) : defaultsDoc,
		);
		versions.value = data.versions;
		secrets.value = await loadSecrets();
		const mail = await loadMailConfig();
		mailConfig.value = mail.config;
		mailSource.value = mail.source;
		callbackUrl.value = `${location.origin}/api/auth/github/callback`;
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
		// 热字段（主题色相、壁纸模式）保存即生效——站长改完切到前台就能看到，
		// 不必再点一次「立即应用」。其余字段仍然要发布 + 等构建。
		if (hotPending.value) {
			try {
				await applyHot();
				await refresh();
				notice.value =
					"已保存。热字段已对访客生效，其余改动要点「发布」才写进仓库。";
			} catch {
				notice.value =
					"草稿已保存。热字段可以点「立即应用」跳过构建，其余需要发布。";
			}
		} else {
			notice.value = "草稿已保存。带绿点的字段可用「立即应用」，其余需要发布。";
		}
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "保存失败";
	} finally {
		busy.value = false;
	}
}

/**
 * 与**构建默认值**比较，提交所有被显式设置过的字段。
 *
 * 不能只提交「与已发布值不同」的项：草稿整份覆盖旧草稿，这次没改的字段就会
 * 从草稿里消失，发布时那份 `config/site.json` 也跟着少字段，线上配置被悄悄
 * 抹回默认值（先改 A 发布、再改 B 发布，A 就没了）。
 * 与默认值相同即不提交，保住「以后改代码默认值还能盖住历史配置」这条。
 */
function collectPatch(): Plain {
	const patch: Plain = {};
	for (const item of flattenDiff(form.value, defaults.value)) {
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

function secretOf(name: string): SecretStatus | undefined {
	return secrets.value.find((item) => item.name === name);
}

function isConfigured(name: string): boolean {
	return secretOf(name)?.configured ?? false;
}

function secretHint(name: string): string {
	const hint = secretOf(name)?.hint;
	return hint ? `已配置 ${hint}` : "未配置";
}

async function copyCallback(): Promise<void> {
	try {
		await navigator.clipboard.writeText(callbackUrl.value);
		notice.value = "回调地址已复制。";
	} catch {
		notice.value = "复制失败，手动选中这行吧。";
	}
}

async function onSaveMail(): Promise<void> {
	mailBusy.value = true;
	mailResult.value = null;
	try {
		mailConfig.value = await saveMailConfig(mailConfig.value);
		notice.value = "发信配置已保存，点「发送测试邮件」确认能发出去。";
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "保存失败";
	} finally {
		mailBusy.value = false;
	}
}

async function onTestMail(): Promise<void> {
	mailTesting.value = true;
	mailResult.value = null;
	try {
		mailResult.value = await testMail();
	} catch (error) {
		mailResult.value = {
			ok: false,
			sent: false,
			mode: mailConfig.value.mode,
			to: "",
			from: mailConfig.value.from,
			message: error instanceof Error ? error.message : "发送失败",
			failed: true,
		};
	} finally {
		mailTesting.value = false;
	}
}

/** 空输入 + 已配置 = 清除，所以按钮文案和二次确认都要跟着变，避免手一点就抹掉密钥 */
function secretActionLabel(name: string): string {
	const typed = (secretInput.value[name] ?? "").trim();
	if (typed) return "保存";
	return isConfigured(name) ? "清除" : "保存";
}

function canSaveSecret(name: string): boolean {
	return Boolean((secretInput.value[name] ?? "").trim()) || isConfigured(name);
}

function onSecretClick(name: string): void {
	const typed = (secretInput.value[name] ?? "").trim();
	if (!typed && isConfigured(name)) {
		if (
			!confirm(
				`清除「${SECRET_LABELS[name] ?? name}」？清掉之后相关的功能会立刻失效。`,
			)
		) {
			return;
		}
	}
	void onSaveSecret(name);
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

		<div class="settings-body">
			<nav class="side-nav">
				<button
					v-for="item in tabs"
					:key="item.key"
					type="button"
					:class="['nav-item', { on: tab === item.key }]"
					@click="tab = item.key"
				>
					<span class="nav-icon" :style="{ '--tone': item.tone }">
						<AppIcon :name="item.icon" :size="15" />
					</span>
					<span class="nav-label">{{ item.label }}</span>
				</button>
			</nav>

			<div class="content">
				<header class="group-head">
					<span class="head-icon" :style="{ '--tone': activeTab.tone }">
						<AppIcon :name="activeTab.icon" :size="24" />
					</span>
					<div class="head-text">
						<h2>{{ activeTab.label }}</h2>
						<p>{{ activeTab.desc }}</p>
					</div>
					<div class="head-side">
						<dl class="facts">
							<div>
								<dt>未保存</dt>
								<dd :class="{ on: unsaved }">
									{{ unsaved ? `${changedFields.length} 处` : "无" }}
								</dd>
							</div>
							<div>
								<dt>待发布</dt>
								<dd :class="{ on: pending.length > 0 }">{{ pending.length }} 处</dd>
							</div>
						</dl>
						<button
							v-if="hotPending || changedAllHot"
							type="button"
							class="btn-regular"
							:disabled="busy"
							@click="onApplyHot"
						>
							立即应用热字段
						</button>
					</div>
				</header>

				<p v-if="hotPending || changedAllHot" class="hint hot-hint">
					带绿点的字段能跳过构建：主题色相、壁纸模式。保存时会自动应用。
				</p>

				<details v-if="pending.length" class="card-base fold">
					<summary>待发布 {{ pending.length }} 项</summary>
					<ul class="diff">
						<li v-for="item in pending" :key="item.path">
							<span class="diff-label">{{ item.label }}</span>
							<span class="diff-value">
								{{ showDiff(item.before) }} → {{ showDiff(item.after) }}
							</span>
						</li>
					</ul>
				</details>

				<div v-if="loading" class="state">读取中…</div>

		<div v-else-if="tab === 'integrations'" class="layout">
			<section class="main">
				<div class="card-base panel">
					<h3>GitHub 登录</h3>
					<p class="hint">
						去 GitHub → Settings → Developer settings → OAuth Apps → New OAuth App 建一个，
						「Authorization callback URL」填下面这行，再把页面上给出的 Client ID 与 Client Secret 抄进来。
						两项都填了登录页的 GitHub 按钮才会真的跳转。
					</p>
					<div class="row">
						<div class="label">
							<span class="name">回调地址</span>
							<span class="hint">必须一字不差，http 与 https、末尾斜杠都算不同</span>
						</div>
						<div class="control copy-row">
							<code class="copy-value">{{ callbackUrl }}</code>
							<button type="button" class="btn-ghost" @click="copyCallback">复制</button>
						</div>
					</div>

					<div v-for="name in GITHUB_LOGIN_SECRETS" :key="name" class="secret">
						<div class="secret-head">
							<strong>{{ SECRET_LABELS[name] }}</strong>
							<span :class="['tag', isConfigured(name) ? 'ok' : 'off']">
								{{ secretHint(name) }}
							</span>
						</div>
						<p class="hint">{{ SECRET_HELP[name] }}</p>
						<div class="secret-row">
							<input
								v-model="secretInput[name]"
								class="field"
								autocomplete="off"
								:placeholder="isConfigured(name) ? '已配置，留空则清除' : '粘贴到这里'"
							/>
							<button
								type="button"
								class="btn-regular"
								:disabled="busy || !canSaveSecret(name)"
								@click="onSecretClick(name)"
							>
								{{ secretActionLabel(name) }}
							</button>
						</div>
					</div>
				</div>

				<div class="card-base panel">
					<h3>发信</h3>
					<p class="hint">
						注册验证与找回密码靠这条通道。一条都没配时不会真发信，只写日志。
						填完先点「发送测试邮件」，收得到再上生产。
					</p>
					<p v-if="mailSource === 'env' && mailConfig.mode !== 'off'" class="hint env-note">
						当前读的是 Worker 环境变量里的配置（RESEND_API_KEY / SMTP_*）。
						下面保存一次就改为以数据库为准。
					</p>

					<div class="row">
						<div class="label">
							<span class="name">通道</span>
							<span class="hint">Resend 是托管发信服务；SMTP 用你自己的邮箱发</span>
						</div>
						<div class="control">
							<select v-model="mailConfig.mode" class="field">
								<option value="off">关闭（只写日志）</option>
								<option value="resend">Resend</option>
								<option value="smtp">SMTP</option>
							</select>
						</div>
					</div>

					<div class="row">
						<div class="label">
							<span class="name">发件人</span>
							<span class="hint">写成「名字 &lt;地址&gt;」；地址必须是验证过的域名</span>
						</div>
						<div class="control">
							<input
								v-model="mailConfig.from"
								class="field"
								placeholder="Yuki Blog <mail@yiyu14.top>"
							/>
						</div>
					</div>

					<template v-if="mailConfig.mode === 'smtp'">
						<div class="row">
							<div class="label">
								<span class="name">SMTP 主机</span>
								<span class="hint">如 smtp.qq.com、smtp.resend.com</span>
							</div>
							<div class="control">
								<input v-model="mailConfig.smtp.host" class="field" placeholder="smtp.qq.com" />
							</div>
						</div>
						<div class="row">
							<div class="label">
								<span class="name">端口</span>
								<span class="hint">SSL 一般 465，STARTTLS 一般 587</span>
							</div>
							<div class="control">
								<input v-model.number="mailConfig.smtp.port" class="field" type="number" min="1" max="65535" />
							</div>
						</div>
						<div class="row">
							<div class="label">
								<span class="name">加密方式</span>
								<span class="hint">465 选 SSL，587 选 STARTTLS；内网中继才选不加密</span>
							</div>
							<div class="control">
								<select v-model="mailConfig.smtp.security" class="field">
									<option value="ssl">SSL（465）</option>
									<option value="starttls">STARTTLS（587）</option>
									<option value="none">不加密</option>
								</select>
							</div>
						</div>
						<div class="row">
							<div class="label">
								<span class="name">用户名</span>
								<span class="hint">通常是完整邮箱地址</span>
							</div>
							<div class="control">
								<input v-model="mailConfig.smtp.user" class="field" placeholder="you@example.com" />
							</div>
						</div>
					</template>

					<p class="hint">
						<template v-if="mailConfig.mode === 'resend'">
							Resend 要先在后台把发件域名加上并按提示配好 DNS，验证通过前只能发给账号自己的邮箱。
						</template>
						<template v-else-if="mailConfig.mode === 'smtp'">
							QQ / 163 这类邮箱要用「授权码」当密码；发件人地址和登录账号不一致时可能被拒信。
						</template>
						<template v-else>
							选一个通道并保存后，会接管所有验证邮件与找回密码邮件。
						</template>
					</p>

					<div
						v-for="name in MAIL_SECRETS.filter(
							(item) =>
								(mailConfig.mode === 'smtp' && item === 'smtp_pass') ||
								(mailConfig.mode === 'resend' && item === 'resend_api_key'),
						)"
						:key="name"
						class="secret"
					>
						<div class="secret-head">
							<strong>{{ SECRET_LABELS[name] }}</strong>
							<span :class="['tag', isConfigured(name) ? 'ok' : 'off']">
								{{ secretHint(name) }}
							</span>
						</div>
						<p class="hint">{{ SECRET_HELP[name] }}</p>
						<div class="secret-row">
							<input
								v-model="secretInput[name]"
								class="field"
								type="password"
								autocomplete="off"
								:placeholder="isConfigured(name) ? '已配置，留空则清除' : '粘贴密钥'"
							/>
							<button
								type="button"
								class="btn-regular"
								:disabled="busy || !canSaveSecret(name)"
								@click="onSecretClick(name)"
							>
								{{ secretActionLabel(name) }}
							</button>
						</div>
					</div>

					<div class="mail-actions">
						<button
							type="button"
							class="btn-regular"
							:disabled="mailBusy"
							@click="onSaveMail"
						>
							保存发信配置
						</button>
						<button
							type="button"
							class="btn-ghost"
							:disabled="mailTesting || mailConfig.mode === 'off'"
							@click="onTestMail"
						>
							{{ mailTesting ? "发送中…" : "发送测试邮件" }}
						</button>
					</div>
					<p v-if="mailResult" :class="['mail-result', mailResult.ok ? 'ok' : 'bad']">
						<template v-if="mailResult.ok">
							已通过 {{ mailResult.mode === "smtp" ? "SMTP" : "Resend" }} 发给
							{{ mailResult.to || "当前账号" }}，去收件箱看看（可能在垃圾箱）。
						</template>
						<template v-else>
							{{ mailResult.message || "发送失败，检查配置后再试" }}
						</template>
					</p>
				</div>

				<div class="card-base panel">
					<h3>发布用令牌</h3>
					<p class="hint">
						管理端改仓库文章、发布稿件都走这个 PAT。它和上面的 OAuth 登录是两回事，别混。
					</p>
					<div v-for="name in PUBLISH_SECRETS" :key="name" class="secret">
						<div class="secret-head">
							<strong>{{ SECRET_LABELS[name] }}</strong>
							<span :class="['tag', isConfigured(name) ? 'ok' : 'off']">
								{{ secretHint(name) }}
							</span>
						</div>
						<p class="hint">{{ SECRET_HELP[name] }}</p>
						<div class="secret-row">
							<input
								v-model="secretInput[name]"
								class="field"
								type="password"
								autocomplete="off"
								:placeholder="isConfigured(name) ? '已配置，留空则清除' : '粘贴令牌'"
							/>
							<button
								type="button"
								class="btn-regular"
								:disabled="busy || !canSaveSecret(name)"
								@click="onSecretClick(name)"
							>
								{{ secretActionLabel(name) }}
							</button>
						</div>
					</div>
				</div>
			</section>
		</div>

		<div v-else class="layout">
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
								<span v-if="field.hot" class="dot hot" title="保存即对访客生效，不必等构建" />
								<span v-else class="dot" title="需要发布并等构建完成" />
							</span>
							<span v-if="field.help" class="hint">{{ field.help }}</span>
						</div>

						<div class="control">
							<WallpaperModePicker
								v-if="field.type === 'select' && field.preview === 'wallpaper'"
								:value="asText(field, section.namespace)"
								:options="field.options ?? []"
								@select="set(field, section.namespace, $event)"
							/>

							<select
								v-else-if="field.type === 'select'"
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
		</div>

		<details class="card-base fold versions-fold">
			<summary>版本历史</summary>
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
		</details>
			</div>
		</div>
	</div>
</template>

<style scoped>
/* 左侧分类：一列分组列表，图标方块 + 名称，选中整条高亮 */
.settings-body {
	display: grid;
	grid-template-columns: 12.5rem minmax(0, 1fr);
	gap: 1.25rem;
	align-items: start;
}

.side-nav {
	position: sticky;
	top: var(--shell-gap);
	display: flex;
	flex-direction: column;
	gap: 0.15rem;
}

.nav-item {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	width: 100%;
	padding: 0.32rem 0.5rem;
	border: none;
	border-radius: 0.55rem;
	background: none;
	color: var(--fg-75);
	font-size: 0.84rem;
	text-align: left;
	cursor: pointer;
	transition:
		background-color 0.15s ease,
		color 0.15s ease;
}

.nav-item:hover {
	background: var(--btn-plain-bg-hover);
	color: var(--fg-90);
}

.nav-item.on {
	background: var(--tab-on-bg);
	color: var(--accent-text);
	font-weight: 600;
}

.nav-icon,
.head-icon {
	display: grid;
	place-items: center;
	color: #fff;
	background: linear-gradient(
		160deg,
		color-mix(in srgb, var(--tone) 74%, white),
		var(--tone)
	);
	box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.26);
}

.nav-icon {
	flex: 0 0 auto;
	width: 1.6rem;
	height: 1.6rem;
	border-radius: 0.45rem;
}

.nav-label {
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.content {
	display: flex;
	flex-direction: column;
	gap: 0.85rem;
	min-width: 0;
}

/* 头部卡：大图标 + 标题 + 说明，右侧挂状态与热应用 */
.group-head {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	gap: 0.95rem;
	align-items: center;
	padding: 1rem 1.15rem;
	border: 1px solid var(--line-divider);
	border-radius: var(--radius-large);
	background: color-mix(in srgb, var(--primary) 5%, var(--card-bg));
}

.head-icon {
	width: 3rem;
	height: 3rem;
	border-radius: 0.85rem;
}

.head-text h2 {
	margin: 0;
	font-size: 1.05rem;
	font-weight: 600;
	color: var(--fg-90);
}

.head-text p {
	margin: 0.22rem 0 0;
	font-size: 0.78rem;
	line-height: 1.6;
	color: var(--fg-50);
}

.head-side {
	display: flex;
	align-items: center;
	gap: 0.85rem;
}

.head-side .facts {
	display: flex;
	gap: 1.1rem;
	margin: 0;
}

.head-side .facts dt {
	font-size: 0.68rem;
}

.head-side .facts dd {
	font-size: 0.86rem;
}

.hot-hint {
	margin: -0.35rem 0 0 0.15rem;
}

/* 折叠块：待发布明细与版本历史，默认收起，避免常驻占位 */
.fold {
	padding: 0.72rem 1.05rem;
}

.fold summary {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	font-size: 0.79rem;
	color: var(--fg-75);
	cursor: pointer;
	list-style: none;
}

.fold summary::-webkit-details-marker {
	display: none;
}

.fold summary::before {
	content: "▸";
	font-size: 0.68rem;
	color: var(--fg-50);
	transition: transform 0.15s ease;
}

.fold[open] summary::before {
	transform: rotate(90deg);
}

.fold[open] summary {
	margin-bottom: 0.6rem;
}

.layout {
	display: block;
}

@media (max-width: 1080px) {
	.settings-body {
		grid-template-columns: minmax(0, 1fr);
		gap: 0.85rem;
	}

	.side-nav {
		position: static;
		flex-direction: row;
		gap: 0.3rem;
		overflow-x: auto;
		padding-bottom: 0.15rem;
		scrollbar-width: none;
	}

	.side-nav::-webkit-scrollbar {
		display: none;
	}

	.nav-item {
		width: auto;
		padding: 0.3rem 0.55rem;
		white-space: nowrap;
	}

	.group-head {
		grid-template-columns: auto minmax(0, 1fr);
	}

	.head-side {
		grid-column: 1 / -1;
		justify-content: space-between;
	}
}

.panel {
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
	color: var(--fg-90);
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
	color: var(--fg-90);
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
	color: var(--fg-90);
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

.copy-row {
	display: flex;
	/* .control 是 column，这里必须显式改回来 */
	flex-direction: row;
	align-items: center;
	gap: 0.4rem;
}

.copy-value {
	flex: 1;
	min-width: 0;
	padding: 0.25rem 0.5rem;
	border: 1px dashed var(--line-divider);
	border-radius: 0.4rem;
	background: var(--btn-regular-bg);
	font-size: 0.74rem;
	word-break: break-all;
	color: var(--fg-90);
}

.mail-actions {
	display: flex;
	gap: 0.5rem;
	margin-top: 0.9rem;
}

.mail-result {
	margin: 0.6rem 0 0;
	font-size: 0.78rem;
	line-height: 1.6;
}

.env-note {
	color: var(--admonitions-color-warning);
}

.mail-result.ok {
	color: var(--admonitions-color-tip);
}

.mail-result.bad {
	color: var(--admonitions-color-caution);
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
	color: var(--fg-90);
	margin: 0 0 0.6rem;
}

.state {
	font-size: 0.85rem;
	color: var(--fg-50);
	padding: 1rem 0;
}
</style>
