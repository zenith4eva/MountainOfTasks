/** Board background: a CSS preset, a file in the data repo, or a URL. Lives in `board.settings.background`. */
export type Background =
  | { kind: 'preset'; id: string }
  | { kind: 'file'; path: string; blob: string; mime: string }
  | { kind: 'url'; url: string }

export interface Preset { id: string; name: string; css: string; animated?: boolean }

// Pure CSS, no assets: works offline and costs nothing in the bundle. Animated ones drift their
// background-position (see .bg-anim in index.css); prefers-reduced-motion freezes them.
export const PRESETS: Preset[] = [
  { id: 'granite', name: 'Granite', css: 'linear-gradient(160deg, #3b3f46, #15171b)' },
  { id: 'dusk', name: 'Dusk', css: 'linear-gradient(165deg, #2b1d4f 0%, #7a3a5c 55%, #e08a5b 100%)' },
  { id: 'fjord', name: 'Fjord', css: 'linear-gradient(170deg, #0b2a3a 0%, #1d5fbf 70%, #7fc4d8 100%)' },
  { id: 'moss', name: 'Moss', css: 'linear-gradient(160deg, #10261c 0%, #2e6b4a 60%, #a9c8a0 100%)' },
  { id: 'paper', name: 'Paper', css: 'radial-gradient(at 20% 10%, #fff 0, #ece9e2 50%, #d8d3c8 100%)' },
  { id: 'aurora', name: 'Aurora', animated: true, css: 'linear-gradient(120deg, #0f2027, #203a43, #2c5364, #3a7d6c, #0f2027)' },
  { id: 'ember', name: 'Ember', animated: true, css: 'linear-gradient(130deg, #1a0b0b, #7a1e1e, #d9552b, #f2b134, #1a0b0b)' },
  { id: 'nebula', name: 'Nebula', animated: true, css: 'linear-gradient(115deg, #120a2a, #4b1d7a, #b03a8a, #ff7a59, #120a2a)' },
  { id: 'lagoon', name: 'Lagoon', animated: true, css: 'linear-gradient(125deg, #022c43, #0a6e8a, #3fb4c8, #a8e6cf, #022c43)' },
  {
    id: 'mesh', name: 'Mesh', animated: true,
    css: 'radial-gradient(at 15% 20%, #ff9a8b 0, transparent 45%), radial-gradient(at 85% 15%, #8bc6ec 0, transparent 45%), radial-gradient(at 70% 85%, #f6d365 0, transparent 50%), radial-gradient(at 20% 80%, #a18cd1 0, transparent 50%), #1b1b1f',
  },
]

export const presetById = (id: string) => PRESETS.find((p) => p.id === id)

export const isVideo = (mimeOrUrl: string) => /^video\//.test(mimeOrUrl) || /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(mimeOrUrl)
