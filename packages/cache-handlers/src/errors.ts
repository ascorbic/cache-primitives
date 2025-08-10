/**
 * Standardized error handling utilities for the cache handlers package.
 */

export type LogLevel = "error" | "warn" | "info" | "debug";

export interface ErrorHandler {
	/**
	 * Log an error or warning message.
	 */
	log(level: LogLevel, message: string, error?: Error): void;

	/**
	 * Handle a recoverable error (doesn't throw).
	 */
	handleRecoverableError(context: string, error: Error): void;

	/**
	 * Handle a critical error (may throw depending on configuration).
	 */
	handleCriticalError(context: string, error: Error): never;
}

/**
 * Default error handler that logs to console.
 */
class DefaultErrorHandler implements ErrorHandler {
	constructor(private silent = false) {}

	log(level: LogLevel, message: string, error?: Error): void {
		if (this.silent) {
			return;
		}

		const fullMessage = error ? `${message}: ${error.message}` : message;

		switch (level) {
			case "error":
				console.error(fullMessage, error);
				break;
			case "warn":
				console.warn(fullMessage, error);
				break;
			case "info":
				console.info(fullMessage);
				break;
			case "debug":
				console.debug(fullMessage);
				break;
		}
	}

	handleRecoverableError(context: string, error: Error): void {
		this.log("warn", `Recoverable error in ${context}`, error);
	}

	handleCriticalError(context: string, error: Error): never {
		this.log("error", `Critical error in ${context}`, error);
		throw new Error(`Critical error in ${context}: ${error.message}`);
	}
}

/**
 * Silent error handler for testing or when logging should be suppressed.
 */
class SilentErrorHandler implements ErrorHandler {
	log(): void {
		// No-op
	}

	handleRecoverableError(): void {
		// No-op
	}

	handleCriticalError(context: string, error: Error): never {
		throw new Error(`Critical error in ${context}: ${error.message}`);
	}
}

/**
 * Global error handler instance.
 */
let globalErrorHandler: ErrorHandler = new DefaultErrorHandler();

/**
 * Set the global error handler for all cache operations.
 */
export function setErrorHandler(handler: ErrorHandler): void {
	globalErrorHandler = handler;
}

/**
 * Get the current global error handler.
 */
export function getErrorHandler(): ErrorHandler {
	return globalErrorHandler;
}

/**
 * Create a default error handler.
 */
export function createDefaultErrorHandler(silent = false): ErrorHandler {
	return new DefaultErrorHandler(silent);
}

/**
 * Create a silent error handler.
 */
export function createSilentErrorHandler(): ErrorHandler {
	return new SilentErrorHandler();
}

/**
 * Utility function to safely handle JSON parsing with consistent error handling.
 */
export async function safeJsonParse<T>(
	response: Response | null,
	defaultValue: T,
	context: string,
): Promise<T> {
	if (!response) {
		return defaultValue;
	}

	try {
		return await response.json();
	} catch (error) {
		globalErrorHandler.handleRecoverableError(
			`JSON parsing in ${context}`,
			error instanceof Error ? error : new Error(String(error)),
		);
		return defaultValue;
	}
}

/**
 * Utility to handle cache operations that may fail.
 */
export async function safeCacheOperation<T>(
	operation: () => Promise<T>,
	fallback: T,
	context: string,
): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		globalErrorHandler.handleRecoverableError(
			`Cache operation in ${context}`,
			error instanceof Error ? error : new Error(String(error)),
		);
		return fallback;
	}
}
