import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
	test: {
		include: ["test/workerd/**/*.test.ts"],
		poolOptions: {
			workers: {
				main: "./test/workerd/worker-entry.ts",
				miniflare: {
					compatibilityDate: "2025-08-03",
					compatibilityFlags: ["nodejs_compat"],
				},
			},
		},
	},
});
