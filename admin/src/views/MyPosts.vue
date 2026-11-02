<script setup lang="ts">
import Pending from "../components/Pending.vue";
</script>

<template>
	<Pending
		title="我的文章"
		desc="草稿存在 D1，提交审核后才写进仓库。"
		:points="[
			'列表按状态分：草稿 / 待审 / 已发布 / 被退',
			'编辑器用 Vditor，1.5 秒防抖自动保存',
			'提交审核入口在编辑器右上角，P4 接入写回 git',
		]"
	/>
</template>
