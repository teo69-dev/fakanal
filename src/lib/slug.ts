// The address of a recipe in a URL: lower case letters, digits and hyphens (src/lib/text.ts slugBase + a random suffix).
export const validSlug = (s: string): boolean => /^[a-z0-9-]{1,80}$/.test(s);
