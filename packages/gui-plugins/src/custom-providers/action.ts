/**
 * Fork feature: the window event the Providers page sends to edit or remove a custom provider. Custom providers are
 * listed with the connected ones there, while this section owns their form, so the page asks it by event.
 */
export const CUSTOM_PROVIDER_ACTION = "opencode:custom-provider-action"

/** What the event carries. */
export type CustomProviderAction = { readonly action: "edit" | "remove"; readonly id: string }
