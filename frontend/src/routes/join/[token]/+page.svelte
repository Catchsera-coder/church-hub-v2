<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { t, locale, tr } from '$lib/i18n.js';

  const token = $page.params.token;
  const base = `/api/public/ministries/${token}`;

  let loading = $state(true);
  let notFound = $state(false);
  let info = $state<any>(null);
  let done = $state(false);
  let submitting = $state(false);
  let error = $state('');

  let f = $state({
    givenName: '', familyName: '', email: '', mobile: '', preferredLanguage: 'en',
    consentEmail: false, consentSms: false, consentWhatsapp: false,
  });
  let newSkill = $state('');
  let skills = $state<string[]>([]);
  function addSkill() { const s = newSkill.trim(); if (s && !skills.includes(s)) skills = [...skills, s]; newSkill = ''; }
  function removeSkill(s: string) { skills = skills.filter((x) => x !== s); }

  onMount(async () => {
    try {
      const res = await fetch(base);
      if (!res.ok) { notFound = true; return; }
      info = (await res.json()).data;
    } catch { notFound = true; } finally { loading = false; }
  });

  async function submit(e: Event) {
    e.preventDefault();
    if (!f.givenName.trim()) { error = tr({ en: 'Please enter your name.', ar: 'يرجى إدخال اسمك.' }, $locale); return; }
    submitting = true; error = '';
    try {
      const res = await fetch(`${base}/join`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          givenName: f.givenName, familyName: f.familyName, email: f.email, mobile: f.mobile,
          preferredLanguage: f.preferredLanguage, skills,
          consent: { email: f.consentEmail, sms: f.consentSms, whatsapp: f.consentWhatsapp },
        }),
      });
      if (!res.ok) { error = tr({ en: 'Something went wrong. Please try again.', ar: 'حدث خطأ. حاول مجدداً.' }, $locale); return; }
      done = true;
    } catch { error = tr({ en: 'Network error. Please try again.', ar: 'خطأ في الشبكة. حاول مجدداً.' }, $locale); }
    finally { submitting = false; }
  }
</script>

<div class="mx-auto max-w-md px-4 py-10">
  {#if loading}
    <p class="text-center text-slate-400">{$t('common.loading')}</p>
  {:else if notFound}
    <div class="card p-8 text-center"><p>{tr({ en: 'This sign-up link is not active.', ar: 'رابط التسجيل هذا غير مفعّل.' }, $locale)}</p></div>
  {:else if done}
    <div class="card space-y-3 p-8 text-center">
      <div class="text-4xl">🎉</div>
      <h1 class="text-xl font-bold">{tr({ en: 'Thank you!', ar: 'شكراً لك!' }, $locale)}</h1>
      <p class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Your interest has been received. Someone from the team will be in touch soon.', ar: 'تم استلام اهتمامك. سيتواصل معك أحد أعضاء الفريق قريباً.' }, $locale)}</p>
    </div>
  {:else if info}
    <div class="mb-4 text-center">
      {#if info.church?.name}<p class="text-sm font-medium" style="color: var(--brand)">{tr(info.church.name, $locale)}</p>{/if}
      <h1 class="text-2xl font-bold">{tr(info.name, $locale)}</h1>
      {#if info.description && tr(info.description, $locale)}<p class="mt-1 text-sm text-slate-500 dark:text-slate-400">{tr(info.description, $locale)}</p>{/if}
      {#if info.meetingDay || info.location}
        <p class="mt-1 text-xs text-slate-400">{[info.meetingDay, info.meetingTime, info.location].filter(Boolean).join(' · ')}</p>
      {/if}
    </div>

    <form class="card space-y-4 p-6" onsubmit={submit}>
      <p class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Interested in serving? Tell us a little about you.', ar: 'مهتم بالخدمة؟ أخبرنا القليل عنك.' }, $locale)}</p>
      {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block space-y-1"><span class="text-xs text-slate-500">{tr({ en: 'First name', ar: 'الاسم الأول' }, $locale)} *</span><input class="input" bind:value={f.givenName} required /></label>
        <label class="block space-y-1"><span class="text-xs text-slate-500">{tr({ en: 'Last name', ar: 'اسم العائلة' }, $locale)}</span><input class="input" bind:value={f.familyName} /></label>
        <label class="block space-y-1"><span class="text-xs text-slate-500">{tr({ en: 'Email', ar: 'البريد' }, $locale)}</span><input class="input force-ltr" type="email" bind:value={f.email} /></label>
        <label class="block space-y-1"><span class="text-xs text-slate-500">{tr({ en: 'Mobile', ar: 'الجوال' }, $locale)}</span><input class="input force-ltr" bind:value={f.mobile} /></label>
      </div>

      <div class="space-y-2">
        <span class="text-xs text-slate-500">{tr({ en: 'Skills / gifts (optional)', ar: 'المواهب (اختياري)' }, $locale)}</span>
        {#if skills.length}<div class="flex flex-wrap gap-2">{#each skills as s}<span class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs dark:bg-slate-800">{s}<button type="button" class="text-slate-400" onclick={() => removeSkill(s)}>✕</button></span>{/each}</div>{/if}
        <div class="flex gap-2"><input class="input" bind:value={newSkill} onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }} placeholder={tr({ en: 'e.g. plays guitar', ar: 'مثال: يعزف الجيتار' }, $locale)} maxlength="40" /><button type="button" class="btn-ghost shrink-0" onclick={addSkill}>{tr({ en: 'Add', ar: 'إضافة' }, $locale)}</button></div>
      </div>

      <div class="space-y-1.5 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
        <p class="text-xs text-slate-500">{tr({ en: 'Okay to contact me by:', ar: 'يمكن التواصل معي عبر:' }, $locale)}</p>
        <label class="flex items-center gap-2"><input type="checkbox" bind:checked={f.consentEmail} /> {tr({ en: 'Email', ar: 'البريد' }, $locale)}</label>
        <label class="flex items-center gap-2"><input type="checkbox" bind:checked={f.consentSms} /> {tr({ en: 'SMS', ar: 'الرسائل النصية' }, $locale)}</label>
        <label class="flex items-center gap-2"><input type="checkbox" bind:checked={f.consentWhatsapp} /> {tr({ en: 'WhatsApp', ar: 'واتساب' }, $locale)}</label>
      </div>

      <button class="btn-primary w-full" type="submit" disabled={submitting}>{submitting ? $t('common.loading') : tr({ en: "I'm interested", ar: 'أنا مهتم' }, $locale)}</button>
    </form>
  {/if}
</div>
