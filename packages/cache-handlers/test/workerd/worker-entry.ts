// Minimal worker entry point for workerd testing
// This provides the basic export that workerd expects

export default {
	async fetch(request: Request, env: any, ctx: any): Promise<Response> {
		// This is just a test entry point - tests don't actually use this
		return new Response("Test worker", {
			headers: { "content-type": "text/plain" },
		});
	},
};
