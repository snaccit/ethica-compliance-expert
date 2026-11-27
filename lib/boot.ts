/** Kennung des laufenden Servers. Ändert sich bei jedem Neustart von "npm run dev" bzw. "npm start". */
const g = globalThis as unknown as { __ceBootId?: string };
export const BOOT_ID = (g.__ceBootId ??= Date.now().toString(36));
