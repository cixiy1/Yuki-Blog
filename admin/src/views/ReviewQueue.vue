<script setup lang="ts">
import Pending from "../components/Pending.vue";
import { canReview } from "../lib/auth";
</script>

<template>
	<Pending
		v-if="canReview"
		title="审核队列"
		desc="待审投稿、通过或退回。"
		:points="[
			'通过：写 src/content/posts/u/<uid>/<slug>/，提交后由 CF 构建上线',
			'退回：写理由，作者在「我的文章」里能看到',
			'组织具备审核权限时只看到自己成员的投稿',
		]"
	/>
	<Pending v-else title="无权访问" desc="审核队列只对审核员与管理员开放。" />
</template>
