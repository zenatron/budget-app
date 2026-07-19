import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		// Server code gets the project service so type-aware rules can run on it.
		// Only no-floating-promises is enabled, not the full recommendedTypeChecked
		// set: the generated `./$types` modules don't resolve under the service, so
		// the no-unsafe-* rules fire on well-typed code and drown the signal.
		// A dropped promise in the sweep or a notify path is an unhandled
		// rejection, which takes the whole process down — that one is worth it.
		files: ['src/lib/**/*.ts', 'src/hooks.server.ts'],
		languageOptions: {
			parserOptions: { projectService: true, parser: ts.parser }
		},
		rules: {
			'@typescript-eslint/no-floating-promises': 'error'
		}
	},
	{
		rules: {
			// The app is never served under a base path; plain hrefs are fine.
			'svelte/no-navigation-without-resolve': 'off'
		}
	},
	{
		// Dev-only seed script: it builds throwaway fixtures, and typing them out
		// buys nothing that shipping code depends on.
		files: ['scripts/**'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': 'off'
		}
	}
);
