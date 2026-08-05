<script lang="ts">
  import { tr, locale } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import TeamMemberForm from '$lib/components/TeamMemberForm.svelte';
</script>

<PageHeader title={tr({ en: 'Invite team member', ar: 'دعوة عضو فريق' }, $locale)} />
<TeamMemberForm />
