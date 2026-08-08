<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { t, locale, tr } from '$lib/i18n.js';
  import { applyBrandColor } from '$lib/stores/brand.js';

  const token = $page.params.token;
  const base = `/api/public/checkin/${token}`;

  let logo = $state<string | null>(null);

  type I18n = Record<string, string>;
  type HouseholdMember = { id: number; name: string; here: boolean };
  type Card = { id: number; name: string; household: { id: number; name: string }[] };

  let loading = $state(true);
  let notActive = $state(false);
  let event = $state<{ title: I18n; startsAt: string; church?: { name: I18n } } | null>(null);

  // 'home' → choose find vs new; 'find' → search; 'confirm' → tick who's here;
  // 'new' → self-registration; 'done' → success.
  let mode = $state<'home' | 'find' | 'confirm' | 'new' | 'done'>('home');
  let error = $state('');
  let submitting = $state(false);
  let result = $state<{ checkedIn: number; registered: number } | null>(null);

  // --- Find flow -------------------------------------------------------------
  let q = $state('');
  let searching = $state(false);
  let searched = $state(false);
  let cards = $state<Card[]>([]);
  let family = $state<HouseholdMember[]>([]); // the chosen card's household, with here flags

  // --- New flow --------------------------------------------------------------
  type NewPerson = { givenName: string; familyName: string; role: string; dateOfBirth: string; attending: boolean };
  const RELATIONSHIPS: { value: string; label: I18n }[] = [
    { value: 'wife', label: { en: 'Wife', ar: 'زوجة' } },
    { value: 'husband', label: { en: 'Husband', ar: 'زوج' } },
    { value: 'daughter', label: { en: 'Daughter', ar: 'ابنة' } },
    { value: 'son', label: { en: 'Son', ar: 'ابن' } },
    { value: 'partner', label: { en: 'Partner', ar: 'شريك' } },
    { value: 'sibling', label: { en: 'Brother / Sister', ar: 'أخ / أخت' } },
    { value: 'parent', label: { en: 'Parent', ar: 'أحد الوالدين' } },
    { value: 'other', label: { en: 'Other', ar: 'آخر' } },
  ];
  let me = $state<{ givenName: string; familyName: string; email: string; mobile: string; preferredLanguage: string; dateOfBirth: string; attending: boolean }>(
    { givenName: '', familyName: '', email: '', mobile: '', preferredLanguage: 'en', dateOfBirth: '', attending: true },
  );
  let consent = $state({ email: false, sms: false, whatsapp: false });
  let relatives = $state<NewPerson[]>([]);

  const today = $derived(
    new Intl.DateTimeFormat($locale === 'ar' ? 'ar' : 'en', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()),
  );
  const churchName = $derived(event?.church?.name ? tr(event.church.name, $locale) : '');

  onMount(async () => {
    // Brand the public form with the church's logo + colour (from public settings).
    try {
      const s = await (await fetch('/api/settings')).json();
      logo = s.data?.logoPath ?? null;
      applyBrandColor(s.data?.brandColor);
    } catch { /* branding is best-effort */ }
    try {
      const res = await fetch(base);
      if (!res.ok) { notActive = true; return; }
      event = (await res.json()).data;
    } catch { notActive = true; } finally { loading = false; }
  });

  function goHome() {
    mode = 'home'; error = ''; q = ''; searched = false; cards = []; family = [];
  }

  async function search(e: Event) {
    e.preventDefault();
    if (q.trim().length < 2) { error = tr({ en: 'Type at least 2 letters of your name.', ar: 'اكتب حرفين على الأقل من اسمك.' }, $locale); return; }
    searching = true; error = '';
    try {
      const res = await fetch(`${base}/search`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: q.trim() }),
      });
      cards = (await res.json()).data as Card[];
      searched = true;
    } catch { error = tr({ en: 'Search failed, please try again.', ar: 'فشل البحث، حاول مجدداً.' }, $locale); } finally { searching = false; }
  }

  // Pick a person → pull their household so they can tick who is present today.
  function pick(card: Card) {
    const seen = new Set<number>();
    const members: HouseholdMember[] = [];
    for (const m of card.household) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      members.push({ id: m.id, name: m.name, here: m.id === card.id }); // pre-tick the person who searched
    }
    if (!members.some((m) => m.id === card.id)) members.unshift({ id: card.id, name: card.name, here: true });
    family = members;
    error = '';
    mode = 'confirm';
  }

  async function submitAttendance() {
    const personIds = family.filter((m) => m.here).map((m) => m.id);
    if (!personIds.length) { error = tr({ en: 'Tick at least one person.', ar: 'حدّد شخصاً واحداً على الأقل.' }, $locale); return; }
    submitting = true; error = '';
    try {
      const res = await fetch(`${base}/record`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ personIds }),
      });
      if (!res.ok) throw new Error();
      result = (await res.json()).data;
      mode = 'done';
    } catch { error = tr({ en: 'Could not check in, please try again.', ar: 'تعذّر التسجيل، حاول مجدداً.' }, $locale); } finally { submitting = false; }
  }

  // --- New self-registration -------------------------------------------------
  function startNew() {
    if (!me.givenName && q.trim()) me.givenName = q.trim(); // carry over what they typed
    mode = 'new'; error = '';
  }
  function addRelative() {
    relatives = [...relatives, { givenName: '', familyName: '', role: '', dateOfBirth: '', attending: true }];
  }
  function removeRelative(i: number) { relatives = relatives.filter((_, idx) => idx !== i); }

  async function submitRegistration() {
    if (!me.givenName.trim()) { error = tr({ en: 'Please enter your first name.', ar: 'يرجى إدخال اسمك الأول.' }, $locale); return; }
    const familyName = me.familyName.trim();
    const people = [
      {
        givenName: me.givenName.trim(),
        familyName,
        role: 'self',
        email: me.email.trim() || undefined,
        mobile: me.mobile.trim() || undefined,
        preferredLanguage: me.preferredLanguage,
        dateOfBirth: me.dateOfBirth || undefined,
        attending: me.attending,
      },
      ...relatives
        .filter((r) => r.givenName.trim())
        .map((r) => ({
          givenName: r.givenName.trim(),
          familyName: (r.familyName.trim() || familyName) || undefined,
          role: r.role || undefined,
          dateOfBirth: r.dateOfBirth || undefined,
          attending: r.attending,
        })),
    ];
    submitting = true; error = '';
    try {
      const res = await fetch(`${base}/record`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ register: { consent, people } }),
      });
      if (!res.ok) throw new Error();
      result = (await res.json()).data;
      mode = 'done';
    } catch { error = tr({ en: 'Could not register, please try again.', ar: 'تعذّر التسجيل، حاول مجدداً.' }, $locale); } finally { submitting = false; }
  }

  function restart() {
    result = null; relatives = []; consent = { email: false, sms: false, whatsapp: false };
    me = { givenName: '', familyName: '', email: '', mobile: '', preferredLanguage: 'en', dateOfBirth: '', attending: true };
    goHome();
  }
</script>

<div class="min-h-screen bg-gradient-to-b from-primary-50 to-white dark:from-slate-900 dark:to-slate-950">
  <div class="mx-auto flex min-h-screen max-w-md flex-col px-4 py-6">
    {#if loading}
      <p class="mt-24 text-center text-slate-400">{$t('common.loading')}</p>
    {:else if notActive}
      <div class="mt-20 rounded-2xl bg-white p-8 text-center shadow-sm dark:bg-slate-900">
        <div class="mb-3 text-4xl">🔒</div>
        <p class="text-lg font-medium">{tr({ en: 'This check-in link is not active.', ar: 'رابط التسجيل غير مُفعّل.' }, $locale)}</p>
        <p class="mt-2 text-sm text-slate-500">{tr({ en: 'Please ask a volunteer for help.', ar: 'يرجى سؤال أحد الخدام للمساعدة.' }, $locale)}</p>
      </div>
    {:else}
      <!-- Warm header -->
      <header class="mb-6 mt-2 text-center">
        {#if logo}<img src={logo} alt="" class="mx-auto mb-3 h-16 w-16 object-contain" />{/if}
        {#if churchName}<p class="text-sm font-medium uppercase tracking-wide" style="color: var(--brand)">{churchName}</p>{/if}
        <h1 class="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{event ? tr(event.title, $locale) : ''}</h1>
        <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">{today}</p>
      </header>

      {#if error}
        <p class="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>
      {/if}

      {#if mode === 'done'}
        <div class="mt-10 rounded-2xl bg-white p-8 text-center shadow-sm dark:bg-slate-900">
          <div class="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-4xl dark:bg-emerald-900/40">🙏</div>
          <h2 class="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{tr({ en: "You're all set!", ar: 'تم كل شيء!' }, $locale)}</h2>
          {#if result}
            <p class="mt-2 text-slate-600 dark:text-slate-300">
              {#if result.checkedIn > 0}
                {result.checkedIn} {result.checkedIn === 1 ? tr({ en: 'person checked in.', ar: 'شخص مسجّل.' }, $locale) : tr({ en: 'people checked in.', ar: 'أشخاص مسجّلون.' }, $locale)}
              {/if}
              {#if result.registered > 0}
                <br />{tr({ en: 'Welcome to the family! 💛', ar: 'أهلاً بكم في العائلة! 💛' }, $locale)}
              {/if}
            </p>
          {/if}
          <button class="mt-6 w-full rounded-xl bg-slate-100 py-3 font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200" onclick={restart}>
            {tr({ en: 'Check in someone else', ar: 'تسجيل شخص آخر' }, $locale)}
          </button>
        </div>

      {:else if mode === 'home'}
        <p class="mb-4 text-center text-slate-600 dark:text-slate-300">{tr({ en: 'Welcome! Let’s get you checked in.', ar: 'أهلاً بك! لنسجّل حضورك.' }, $locale)}</p>
        <button class="mb-3 flex w-full items-center gap-4 rounded-2xl bg-white p-5 text-start shadow-sm transition active:scale-[.98] dark:bg-slate-900" onclick={() => (mode = 'find')}>
          <span class="text-3xl">🔎</span>
          <span>
            <span class="block text-lg font-semibold text-slate-900 dark:text-white">{tr({ en: 'Find my name', ar: 'ابحث عن اسمي' }, $locale)}</span>
            <span class="block text-sm text-slate-500 dark:text-slate-400">{tr({ en: "I've been here before", ar: 'لقد حضرت من قبل' }, $locale)}</span>
          </span>
        </button>
        <button class="flex w-full items-center gap-4 rounded-2xl bg-white p-5 text-start shadow-sm transition active:scale-[.98] dark:bg-slate-900" onclick={startNew}>
          <span class="text-3xl">✨</span>
          <span>
            <span class="block text-lg font-semibold text-slate-900 dark:text-white">{tr({ en: "I'm new here", ar: 'أنا جديد هنا' }, $locale)}</span>
            <span class="block text-sm text-slate-500 dark:text-slate-400">{tr({ en: 'Add myself and my family', ar: 'أضف نفسي وعائلتي' }, $locale)}</span>
          </span>
        </button>

      {:else if mode === 'find'}
        <form class="mb-4 flex gap-2" onsubmit={search}>
          <input class="input flex-1 text-base" bind:value={q} placeholder={tr({ en: 'Type your name…', ar: 'اكتب اسمك…' }, $locale)} />
          <button class="btn-primary shrink-0" type="submit" disabled={searching}>{searching ? '…' : tr({ en: 'Search', ar: 'بحث' }, $locale)}</button>
        </form>

        {#if searched}
          {#if cards.length}
            <p class="mb-2 text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Tap your name:', ar: 'اضغط على اسمك:' }, $locale)}</p>
            <div class="space-y-2">
              {#each cards as c}
                <button class="flex w-full items-center justify-between rounded-xl bg-white p-4 text-start shadow-sm transition active:scale-[.98] dark:bg-slate-900" onclick={() => pick(c)}>
                  <span>
                    <span class="block font-medium text-slate-900 dark:text-white">{c.name}</span>
                    {#if c.household.length > 1}<span class="text-xs text-slate-500 dark:text-slate-400">{c.household.length} {tr({ en: 'in household', ar: 'في الأسرة' }, $locale)}</span>{/if}
                  </span>
                  <span class="text-slate-400">›</span>
                </button>
              {/each}
            </div>
          {:else}
            <div class="rounded-xl bg-amber-50 p-4 text-center dark:bg-amber-900/20">
              <p class="text-sm text-amber-800 dark:text-amber-200">{tr({ en: "We couldn't find that name.", ar: 'لم نتمكن من إيجاد هذا الاسم.' }, $locale)}</p>
              <button class="mt-3 w-full rounded-xl bg-primary-600 py-2.5 font-medium text-white" onclick={startNew}>{tr({ en: "I'm new — add me", ar: 'أنا جديد — أضفني' }, $locale)}</button>
            </div>
          {/if}
        {/if}
        <button class="mt-4 text-sm text-slate-500 hover:underline" onclick={goHome}>← {tr({ en: 'Back', ar: 'رجوع' }, $locale)}</button>

      {:else if mode === 'confirm'}
        <p class="mb-2 text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Who is here today?', ar: 'من الحاضر اليوم؟' }, $locale)}</p>
        <div class="overflow-hidden rounded-2xl bg-white shadow-sm dark:bg-slate-900">
          {#each family as m}
            <label class="flex items-center gap-3 border-b border-slate-100 p-4 text-base last:border-0 dark:border-slate-800">
              <input type="checkbox" class="h-6 w-6 rounded" bind:checked={m.here} />
              <span class="text-slate-900 dark:text-white">{m.name}</span>
            </label>
          {/each}
        </div>
        <button class="btn-primary mt-5 w-full py-3.5 text-base" onclick={submitAttendance} disabled={submitting}>
          {submitting ? $t('common.loading') : tr({ en: 'Check in', ar: 'تسجيل الحضور' }, $locale)}
        </button>
        <button class="mt-3 text-sm text-slate-500 hover:underline" onclick={() => (mode = 'find')}>← {tr({ en: 'Back', ar: 'رجوع' }, $locale)}</button>

      {:else if mode === 'new'}
        <div class="space-y-4">
          <!-- You -->
          <div class="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
            <p class="mb-3 font-semibold text-slate-900 dark:text-white">{tr({ en: 'About you', ar: 'عنك' }, $locale)}</p>
            <div class="flex gap-2">
              <input class="input" bind:value={me.givenName} placeholder={tr({ en: 'First name', ar: 'الاسم الأول' }, $locale)} />
              <input class="input" bind:value={me.familyName} placeholder={tr({ en: 'Last name', ar: 'اسم العائلة' }, $locale)} />
            </div>
            <input class="input mt-2" bind:value={me.mobile} type="tel" placeholder={tr({ en: 'Mobile (optional)', ar: 'الجوال (اختياري)' }, $locale)} />
            <input class="input mt-2" bind:value={me.email} type="email" placeholder={tr({ en: 'Email (optional)', ar: 'البريد الإلكتروني (اختياري)' }, $locale)} />
            <label class="mt-3 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" class="h-5 w-5 rounded" bind:checked={me.attending} />
              {tr({ en: "I'm here today", ar: 'أنا حاضر اليوم' }, $locale)}
            </label>
          </div>

          <!-- Family -->
          <div class="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
            <p class="mb-1 font-semibold text-slate-900 dark:text-white">{tr({ en: 'Family with me', ar: 'العائلة معي' }, $locale)}</p>
            <p class="mb-3 text-xs text-slate-500 dark:text-slate-400">{tr({ en: 'Add anyone who came with you.', ar: 'أضف كل من حضر معك.' }, $locale)}</p>
            {#each relatives as r, i}
              <div class="mb-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div class="flex gap-2">
                  <input class="input" bind:value={r.givenName} placeholder={tr({ en: 'First name', ar: 'الاسم الأول' }, $locale)} />
                  <button type="button" class="shrink-0 px-2 text-rose-500" onclick={() => removeRelative(i)} aria-label="remove">✕</button>
                </div>
                <select class="input mt-2" bind:value={r.role}>
                  <option value="">{tr({ en: 'Relationship…', ar: 'صلة القرابة…' }, $locale)}</option>
                  {#each RELATIONSHIPS as opt}<option value={opt.value}>{tr(opt.label, $locale)}</option>{/each}
                </select>
                <div class="mt-2 flex items-center gap-3">
                  <label class="flex-1 text-xs text-slate-500 dark:text-slate-400">
                    {tr({ en: 'Birth date (helps for kids)', ar: 'تاريخ الميلاد (مفيد للأطفال)' }, $locale)}
                    <input class="input force-ltr mt-1" type="date" bind:value={r.dateOfBirth} />
                  </label>
                  <label class="flex items-center gap-2 pt-4 text-sm text-slate-700 dark:text-slate-200">
                    <input type="checkbox" class="h-5 w-5 rounded" bind:checked={r.attending} />
                    {tr({ en: 'Here', ar: 'حاضر' }, $locale)}
                  </label>
                </div>
              </div>
            {/each}
            <button type="button" class="w-full rounded-xl border border-dashed border-slate-300 py-2.5 text-sm font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300" onclick={addRelative}>
              + {tr({ en: 'Add a family member', ar: 'إضافة أحد أفراد العائلة' }, $locale)}
            </button>
          </div>

          <!-- Consent (positive opt-in) -->
          <div class="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
            <p class="mb-1 font-semibold text-slate-900 dark:text-white">{tr({ en: 'Stay connected', ar: 'ابقَ على تواصل' }, $locale)}</p>
            <p class="mb-3 text-xs text-slate-500 dark:text-slate-400">{tr({ en: "We'd love to keep you posted on services and events. Tick how you'd like to hear from us:", ar: 'يسعدنا إبقاؤك على اطلاع بالخدمات والفعاليات. حدّد كيف تحب أن نتواصل معك:' }, $locale)}</p>
            <label class="flex items-center gap-3 py-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" class="h-5 w-5 rounded" bind:checked={consent.email} /> {tr({ en: 'Email me', ar: 'راسلني بالبريد الإلكتروني' }, $locale)}
            </label>
            <label class="flex items-center gap-3 py-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" class="h-5 w-5 rounded" bind:checked={consent.sms} /> {tr({ en: 'Text me (SMS)', ar: 'راسلني برسالة نصية' }, $locale)}
            </label>
            <label class="flex items-center gap-3 py-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" class="h-5 w-5 rounded" bind:checked={consent.whatsapp} /> {tr({ en: 'WhatsApp me', ar: 'راسلني عبر واتساب' }, $locale)}
            </label>
          </div>

          <button class="btn-primary w-full py-3.5 text-base" onclick={submitRegistration} disabled={submitting}>
            {submitting ? $t('common.loading') : tr({ en: 'Join & check in', ar: 'انضمّ وسجّل الحضور' }, $locale)}
          </button>
          <button class="mt-1 w-full text-sm text-slate-500 hover:underline" onclick={goHome}>← {tr({ en: 'Back', ar: 'رجوع' }, $locale)}</button>
        </div>
      {/if}
    {/if}
  </div>
</div>
