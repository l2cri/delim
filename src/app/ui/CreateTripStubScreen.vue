<template>
  <div
    class="flex min-h-dvh flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
  >
    <header class="mx-auto flex w-full max-w-md items-center gap-3 px-5 pt-8">
      <svg viewBox="0 0 24 24" class="size-8 text-emerald-600" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.5" />
        <path d="M12 5.5 A 6 6 0 0 0 12 18.5 Z" fill="currentColor" />
      </svg>
      <span class="text-xl font-semibold tracking-tight">Делим</span>
    </header>

    <main class="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-5 py-10">
      <section class="space-y-2 text-center">
        <h2 class="text-2xl font-bold tracking-tight sm:text-3xl">
          Долги поездки — в минимум переводов
        </h2>
        <p class="text-sm text-zinc-500 dark:text-zinc-400 sm:text-base">
          Поровну, точными суммами или долями — в любых валютах с ручными курсами.
          Без регистрации, сервера и сети.
        </p>
      </section>

      <section
        class="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        aria-labelledby="create-trip-heading"
      >
        <h3 id="create-trip-heading" class="font-medium">Поездка пока не создана</h3>
        <p class="text-sm text-zinc-500 dark:text-zinc-400">
          Здесь появится создание первой поездки: название, базовая валюта и участники —
          и можно раскидывать чеки.
        </p>
        <button
          type="button"
          disabled
          aria-disabled="true"
          class="w-full cursor-not-allowed rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white opacity-50"
        >
          Создать поездку
        </button>
        <p class="text-center text-xs text-zinc-400 dark:text-zinc-600">
          Экран в разработке — появится в ближайших сборках
        </p>
      </section>
    </main>

    <footer class="px-5 pb-6 text-center text-xs text-zinc-400 dark:text-zinc-600">
      Работает офлайн · данные хранятся только на устройстве
    </footer>
  </div>
</template>
