<script lang="ts">
  import { tr, locale } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import FundForm from '$lib/components/FundForm.svelte';
</script>

<PageHeader title={tr({ en: 'New fund', ar: 'صندوق جديد' }, $locale)} />
<FundForm />
