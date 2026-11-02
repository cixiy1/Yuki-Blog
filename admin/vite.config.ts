import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

/**
 * 管理端产物直接落到主站的 public/admin/，由 astro build 拷进 dist/admin/。
 * 不走 public/admin 之外的目录，是为了让 `pnpm build` 一条命令产出完整站点。
 */
export default defineConfig({
	base: "/admin/",
	plugins: [vue()],
	build: {
		outDir: "../public/admin",
		emptyOutDir: true,
		// 管理端只在登录后访问，源码映射不进线上包
		sourcemap: false,
	},
	server: {
		port: 5173,
		// 本地开发：/api 转发到 wrangler dev，cookie 同主机不受端口影响
		proxy: {
			"/api": {
				target: "http://127.0.0.1:8787",
				changeOrigin: false,
			},
		},
	},
});
