<script setup lang="ts">
import Pending from "../components/Pending.vue";
</script>

<template>
	<Pending
		title="我的组件"
		desc="放在 src/components/user/<uid>/ 下的可复用组件。"
		:points="[
			'只能 import 自己的组件目录，站点内部路径与外部 URL 一律拒绝',
			'组件在构建期执行，等同任意代码，所以只允许本人维护',
			'写完在文章里 import 即可，路径固定为 @/components/user/<uid>/',
		]"
	/>
</template>
