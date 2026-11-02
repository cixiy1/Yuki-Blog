<script setup lang="ts">
import Pending from "../components/Pending.vue";
</script>

<template>
	<Pending
		title="编辑文章"
		desc="Vditor 编辑器、frontmatter 表单与自动保存。"
		:points="[
			'工具栏按主站写作习惯裁剪过，去掉不用的按钮',
			'深浅色与主站同步（读 localStorage 的 theme / hue）',
			'图片上传走 /api/media，回填 Markdown 链接',
		]"
	/>
</template>
