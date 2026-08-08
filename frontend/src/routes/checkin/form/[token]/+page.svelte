<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { t, locale, tr } from '$lib/i18n.js';
  import { applyBrandColor } from '$lib/stores/brand.js';

  type Field = { key: string; label: Record<string, string>; type: string; required: boolean; forWhom: 'primary' | 'all'; options?: string[] };
  const token = $page.params.token;
  const base = `/api/public/checkin/form/${token}`;

  let loading = $state(true);
  let notActive = $state(false);
  let logo = $state<string | null>(null);
  let form = $state<{ name: Record<string, string>; intro: Record<string, string>; fields: Field[]; showFamily: boolean; showConsent: boolean; church?: { name: Record<string, string> } } | null>(null);

  let me = $state<Record<string, string>>({});
  let family = $state<Record<string, string>[]>([]);
  let consent = $state({ email: false, sms: false, whatsapp: false });

  let submitting = $state(false);
  let error = $state('');
  let done = $state(false);

  const churchName = $derived(form?.church?.name ? tr(form.church.name, $locale) : '');
  const primaryFields = $derived(form?.fields ?? []);
  const memberFields = $derived((form?.fields ?? []).filter((f) => f.forWhom === 'all'));

  onMount(async () => {
    try {
      const s = await (await fetch('/api/settings')).json();
      logo = s.data?.logoPath ?? null;
      applyBrandColor(s.data?.brandColor);
    } catch { /* branding best-effort */ }
    try {
      const res = await fetch(base);
      if (!res.ok) { notActive = true; return; }
      form = (await res.json()).data;
    } catch { notActive = true; } finally { loading = false; }
  });

  function addMember() { family = [...family, {}]; }
  function removeMember(i: number) { family = family.filter((_, idx) => idx !== i); }

  async function submit() {
    // Required primary fields must be filled.
    const missing = primaryFields.filter((f) => f.required && f.type !== 'checkbox' && !me[f.key]?.trim?.());
    if (missing.length) { error = tr({ en: 'Please fill the required fields.', ar: 'يرجى ملء الحقول المطلوبة.' }, $locale); return; }
    submitting = true; error = '';
    try {
      const people = [me, ...family.filter((m) => m.givenName?.trim())];
      const res = await fetch(`${base}/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent, people }),
      });
      if (!res.ok) throw new Error();
      done = true;
    } catch { error = tr({ en: 'Could not submit, please try again.', ar: 'تعذّر الإرسال، حاول مجدداً.' }, $locale); } finally { submitting = false; }
  }
</script>

{#snippet fieldControl(f: Field, model: Record<string, string>)}
  <label class="block space-y-1">
    <span class="text-sm text-slate-600 dark:text-slate-300">{tr(f.label, $locale)}{#if f.required}<span class="text-rose-500"> *</span>{/if}</span>
    {#if f.type === 'select'}
      <select class="input" bind:value={model[f.key]}>
        <option value="">—</option>
        {#each f.options ?? [] as o}<option value={o}>{o}</option>{/each}
      </select>
    {:else if f.type === 'checkbox'}
      <input type="checkbox" class="h-5 w-5 rounded" checked={model[f.key] === 'true'} onchange={(e) => (model[f.key] = (e.currentTarget as HTMLInputElement).checked ? 'true' : '')} />
    {:else}
      <input class="input {f.type === 'tel' || f.type === 'email' || f.type === 'date' ? 'force-ltr' : ''}" type={f.type} bind:value={model[f.key]} />
    {/if}
  </label>
{/snippet}

<div class="min-h-screen bg-gradient-to-b from-primary-50 to-white dark:from-slate-900 dark:to-slate-950">
  <div class="mx-auto flex min-h-screen max-w-md flex-col px-4 py-6">
    {#if loading}
      <p class="mt-24 text-center text-slate-400">{$t('common.loading')}</p>
    {:else if notActive}
      <div class="mt-20 rounded-2xl bg-white p-8 text-center shadow-sm dark:bg-slate-900">
        <div class="mb-3 text-4xl">🔒</div>
        <p class="text-lg font-medium">{tr({ en: 'This form is not active.', ar: 'هذا النموذج غير مُفعّل.' }, $locale)}</p>
      </div>
    {:else if done}
      <div class="mt-16 rounded-2xl bg-white p-8 text-center shadow-sm dark:bg-slate-900">
        <div class="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-4xl dark:bg-emerald-900/40">🙏</div>
        <h2 class="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{tr({ en: 'Thank you!', ar: 'شكراً لك!' }, $locale)}</h2>
        <p class="mt-2 text-slate-600 dark:text-slate-300">{tr({ en: "We've received your details. Welcome! 💛", ar: 'استلمنا بياناتك. أهلاً بك! 💛' }, $locale)}</p>
      </div>
    {:else if form}
      <header class="mb-6 mt-2 text-center">
        {#if logo}<img src={logo} alt="" class="mx-auto mb-3 h-16 w-16 object-contain" />{/if}
        {#if churchName}<p class="text-sm font-medium uppercase tracking-wide" style="color: var(--brand)">{churchName}</p>{/if}
        <h1 class="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{tr(form.name, $locale)}</h1>
        {#if tr(form.intro, $locale)}<p class="mt-2 text-sm text-slate-500 dark:text-slate-400">{tr(form.intro, $locale)}</p>{/if}
      </header>

      {#if error}<p class="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}

      <div class="space-y-4">
        <div class="space-y-3 rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
          {#each primaryFields as f}{@render fieldControl(f, me)}{/each}
        </div>

        {#if form.showFamily}
          <div class="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
            <p class="mb-3 font-semibold text-slate-900 dark:text-white">{tr({ en: 'Family with me', ar: 'العائلة معي' }, $locale)}</p>
            {#each family as m, i}
              <div class="mb-3 space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div class="flex justify-end"><button type="button" class="text-rose-500" onclick={() => removeMember(i)} aria-label="remove">✕</button></div>
                {#each memberFields as f}{@render fieldControl(f, m)}{/each}
              </div>
            {/each}
            <button type="button" class="w-full rounded-xl border border-dashed border-slate-300 py-2.5 text-sm font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300" onclick={addMember}>
              + {tr({ en: 'Add a family member', ar: 'إضافة أحد أفراد العائلة' }, $locale)}
            </button>
          </div>
        {/if}

        {#if form.showConsent}
          <div class="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
            <p class="mb-1 font-semibold text-slate-900 dark:text-white">{tr({ en: 'Stay connected', ar: 'ابقَ على تواصل' }, $locale)}</p>
            <p class="mb-3 text-xs text-slate-500 dark:text-slate-400">{tr({ en: 'Tick how you’d like to hear from us:', ar: 'حدّد كيف تحب أن نتواصل معك:' }, $locale)}</p>
            <label class="flex items-center gap-3 py-2 text-sm text-slate-700 dark:text-slate-200"><input type="checkbox" class="h-5 w-5 rounded" bind:checked={consent.email} /> {tr({ en: 'Email me', ar: 'راسلني بالبريد' }, $locale)}</label>
            <label class="flex items-center gap-3 py-2 text-sm text-slate-700 dark:text-slate-200"><input type="checkbox" class="h-5 w-5 rounded" bind:checked={consent.sms} /> {tr({ en: 'Text me (SMS)', ar: 'راسلني برسالة نصية' }, $locale)}</label>
            <label class="flex items-center gap-3 py-2 text-sm text-slate-700 dark:text-slate-200"><input type="checkbox" class="h-5 w-5 rounded" bind:checked={consent.whatsapp} /> {tr({ en: 'WhatsApp me', ar: 'راسلني عبر واتساب' }, $locale)}</label>
          </div>
        {/if}

        <button class="btn-primary w-full py-3.5 text-base" onclick={submit} disabled={submitting}>
          {submitting ? $t('common.loading') : tr({ en: 'Submit', ar: 'إرسال' }, $locale)}
        </button>
      </div>
    {/if}
  </div>
</div>
