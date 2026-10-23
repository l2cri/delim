/** Слив микрозадач Vue: даёт отработать watch-колбэкам независимо от копии фреймворка. */
export async function flushWatchers(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}
