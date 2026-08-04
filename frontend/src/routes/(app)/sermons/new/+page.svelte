<script lang="ts">
  import { tr, locale } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SermonForm from '$lib/components/SermonForm.svelte';
</script>

<PageHeader title={tr({ en: 'New sermon', ar: 'عظة جديدة' }, $locale)} />
<SermonForm />
