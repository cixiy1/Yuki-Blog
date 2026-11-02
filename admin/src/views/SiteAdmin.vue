<script setup lang="ts">
import Pending from "../components/Pending.vue";
import { isAdmin } from "../lib/auth";
</script>

<template>
	<Pending
		v-if="isAdmin"
		title="站点管理"
		desc="用户、组织、说说、项目、友链、媒体、设置与审计。"
		:points="[
			'用户：改角色、封禁、看登录记录',
			'组织：审批创建、授予审核权限',
			'设置：含密钥写入，只写不回显',
		]"
	/>
	<Pending v-else title="无权访问" desc="站点管理只对管理员开放。" />
</template>
