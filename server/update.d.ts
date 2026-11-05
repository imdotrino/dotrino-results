// `@dotrino/update` 0.7.0 no publica tipos. Esto declara solo lo que usa server.js,
// tal como lo define node_modules/@dotrino/update/src/checkout.js.
declare module '@dotrino/update/checkout' {
  export function watchCheckout (opts: {
    dir: string
    repo: string
    name?: string
    branch?: string
    log?: (msg: string) => void
    onBehind?: (r: { running: string, latest: string }) => void
    everyMs?: number
  }): () => void
}
