<script lang="ts">
  import { tr, locale } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import FamilyForm from '$lib/components/FamilyForm.svelte';
</script>

<PageHeader title={tr({ en: 'New family', ar: 'عائلة جديدة' }, $locale)} />
<FamilyForm />
