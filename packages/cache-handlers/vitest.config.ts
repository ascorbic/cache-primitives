import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/node/**/*.test.ts"],
		environment: "node",
		globals: true,
		setupFiles: ["test/node/setup.ts"],
	},
});
