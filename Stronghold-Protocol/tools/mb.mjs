/** `${n} MB`，两位小数（tools/package.mjs 里那个是私有的）。 */
export const MB = (n) => `${(n / 1048576).toFixed(2)} MB`;
