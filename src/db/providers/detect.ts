/**
 * Auto-detect the database provider from a connection string.
 */
export function detectProvider(connectionString: string): 'postgres' | 'mysql' | 'sqlite' {
  const s = connectionString.trim().toLowerCase();
  if (s.startsWith('postgresql://') || s.startsWith('postgres://')) return 'postgres';
  if (s.startsWith('mysql://') || s.startsWith('mysql2://')) return 'mysql';
  if (
    s.startsWith('file:') ||
    s.endsWith('.db') ||
    s.endsWith('.sqlite') ||
    s.endsWith('.sqlite3') ||
    s === ':memory:'
  ) {
    return 'sqlite';
  }
  throw new Error(
    `Cannot detect database provider from connection string. ` +
    `Supported prefixes: postgresql://, postgres://, mysql://, file:, or a path ending in .db/.sqlite. ` +
    `Use the provider parameter to specify it explicitly.`,
  );
}

/**
 * Mask the password in a connection string for safe logging.
 * postgresql://user:SECRET@host:5432/db → postgresql://user:****@host:5432/db
 */
export function maskConnectionString(connectionString: string): string {
  return connectionString.replace(/(:\/\/[^:]+:)[^@]+(@)/, '$1****$2');
}
