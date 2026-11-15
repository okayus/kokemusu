// What stays on screen after rendering itself threw. React answers an error
// no boundary caught by taking the whole tree down — a blank page with no way
// back — so main.tsx renders this in its place (createRoot's onUncaughtError).
// No state, no fetch, no props: nothing here can throw a second time.
export function FatalScreen() {
  return (
    <main className="shell">
      <div className="hero" role="alert">
        <h1>表示できませんでした</h1>
        <p className="quiet">
          画面を描いている途中でエラーが起きました。再読み込みすると直ることがあります。
        </p>
      </div>
      <button type="button" className="primary" onClick={() => location.reload()}>
        再読み込み
      </button>
    </main>
  );
}
