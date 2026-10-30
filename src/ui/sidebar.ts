import { h } from './dom.ts';

export interface SidebarTabs {
  add(name: string, panel: HTMLElement): void;
  show(name: string): void;
}

/** Tab strip at the top of the sidebar. */
export function mountSidebar(sidebar: HTMLElement): SidebarTabs {
  const strip = h('div.tabs');
  const body = h('div.tab-body');
  sidebar.append(strip, body);
  const tabs = new Map<string, { button: HTMLButtonElement; panel: HTMLElement }>();
  const show = (name: string) => {
    for (const [n, t] of tabs) {
      t.button.classList.toggle('active', n === name);
      t.panel.hidden = n !== name;
    }
  };
  return {
    add(name, panel) {
      const button = h('button', { onclick: () => show(name) }, name);
      strip.append(button);
      body.append(panel);
      tabs.set(name, { button, panel });
      if (tabs.size === 1) show(name);
      else panel.hidden = true;
    },
    show,
  };
}
