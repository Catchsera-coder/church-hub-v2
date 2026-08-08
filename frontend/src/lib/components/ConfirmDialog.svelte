<script lang="ts">
  import { locale, tr } from '$lib/i18n.js';

  // A reusable confirm modal. Replaces native confirm(). Supports a destructive
  // style and an optional type-to-confirm gate (the user must type `requireText`
  // exactly before the confirm button enables) — used for high-stakes deletes.
  let {
    open = $bindable(false),
    title,
    message,
    confirmLabel,
    cancelLabel,
    danger = false,
    requireText,
    busy = false,
    onconfirm,
    oncancel,
  }: {
    open?: boolean;
    title: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    requireText?: string;
    busy?: boolean;
    onconfirm?: () => void;
    oncancel?: () => void;
  } = $props();

  let typed = $state('');
  const ready = $derived(!requireText || typed.trim() === requireText.trim());

  function cancel() { open = false; typed = ''; oncancel?.(); }
  function confirm() { if (ready && !busy) { onconfirm?.(); } }
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <button class="absolute inset-0 bg-black/50" aria-label={tr({ en: 'Close', ar: 'إغلاق' }, $locale)} onclick={cancel}></button>
    <div class="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900" role="dialog" aria-modal="true">
      <h2 class="text-lg font-semibold {danger ? 'text-rose-600 dark:text-rose-400' : ''}">{title}</h2>
      {#if message}<p class="mt-2 whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">{message}</p>{/if}

      {#if requireText}
        <label class="mt-4 block space-y-1">
          <span class="text-xs text-slate-500 dark:text-slate-400">{tr({ en: 'Type', ar: 'اكتب' }, $locale)} <b class="font-mono">{requireText}</b> {tr({ en: 'to confirm', ar: 'للتأكيد' }, $locale)}</span>
          <input class="input" bind:value={typed} autocomplete="off" />
        </label>
      {/if}

      <div class="mt-6 flex justify-end gap-2">
        <button class="btn-ghost" onclick={cancel} disabled={busy}>{cancelLabel ?? tr({ en: 'Cancel', ar: 'إلغاء' }, $locale)}</button>
        <button
          class="btn {danger ? 'bg-rose-600 text-white hover:bg-rose-700' : 'btn-primary'}"
          onclick={confirm}
          disabled={!ready || busy}
        >{busy ? '…' : (confirmLabel ?? tr({ en: 'Confirm', ar: 'تأكيد' }, $locale))}</button>
      </div>
    </div>
  </div>
{/if}
