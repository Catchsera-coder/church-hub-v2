<script lang="ts">
  import { tr, locale } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import EventForm from '$lib/components/EventForm.svelte';
</script>

<PageHeader title={tr({ en: 'New event', ar: 'فعالية جديدة' }, $locale)} />
<EventForm />
