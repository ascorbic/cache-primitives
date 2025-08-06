import type { UserConfig } from "tsdown";

export default {
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	publint: {
		strict: true,
	},
	attw: {
		level: "error",
	},
} satisfies UserConfig;
