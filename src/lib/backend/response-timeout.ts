/** Keep the chat bounded after partial replies when the completion event is lost. */
export function refreshResponseTimeout(
    previous: ReturnType<typeof setTimeout> | null,
    onIdle: () => void,
    idleMs = 60000,
): ReturnType<typeof setTimeout> {
    if (previous) clearTimeout(previous);
    return setTimeout(onIdle, idleMs);
}
