// Хелпер буфера обмена UI: копирование текста без библиотек. Живёт в ui, а не
// в ядре — это браузерная способность экрана, не денежное правило (тикет 15:
// кроме квитанции, ссылкой теперь делится и кнопка «Поделиться»).

/**
 * Копирование текста: navigator.clipboard, при отсутствии или отказе — скрытая
 * textarea + execCommand('copy') (старые WebView). Успех любым путём — true.
 */
export async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Отказ API (небезопасный контекст, нет фокуса) — пробуем фолбэк ниже.
  }
  return copyViaHiddenTextarea(text)
}

function copyViaHiddenTextarea(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  // За пределами вьюпорта и прозрачно, но фокусируемо: скрытый display:none
  // не выделяется execCommand'ом.
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  textarea.remove()
  return ok
}
