import {
	App,
	Plugin,
	PluginSettingTab,
	Menu,
	Notice,
	type Setting,
	type MenuPositionDef,
	type SettingDefinition,
	type SettingDefinitionGroup,
	type SettingDefinitionItem
} from 'obsidian';

interface RibbonHiderSettings {
	hiddenButtons: string[];
}

/**
 * `App.setting` is the undocumented handle to the settings modal. It is not part
 * of the public API, so describe the shape we rely on instead of casting to `any`.
 */
interface SettingsModal {
	open(): void | Promise<void>;
	openTabById(id: string): void;
}

type AppWithSettingsModal = App & { setting?: SettingsModal };

const DEFAULT_SETTINGS: RibbonHiderSettings = {
	hiddenButtons: []
};

/** Containers whose children we are willing to touch. */
const RIBBON_CONTAINERS = '.workspace-ribbon, .side-dock-ribbon';

/** Ribbon buttons, scoped to the containers above so we never match unrelated UI. */
const RIBBON_ITEMS = [
	'.workspace-ribbon .workspace-ribbon-item',
	'.workspace-ribbon .clickable-icon',
	'.side-dock-ribbon .side-dock-ribbon-action',
	'.side-dock-ribbon .clickable-icon'
].join(', ');

const RIBBON_ACTIONS = '.side-dock-ribbon-action, .workspace-ribbon-item, .clickable-icon';

/** Applied to hidden ribbon buttons; the rule itself lives in styles.css. */
const HIDDEN_CLASS = 'ribbon-hider-hidden';

/** Prefix for the declarative-settings control keys, e.g. `visible:Open graph view`. */
const VISIBILITY_KEY_PREFIX = 'visible:';

/** Collapse/expand controls are structural, so they are never offered for hiding. */
function isHideable(label: string): boolean {
	const lower = label.toLowerCase();
	return !lower.includes('collapse') && !lower.includes('expand');
}

export default class RibbonHiderPlugin extends Plugin {
	settings!: RibbonHiderSettings;
	observer!: MutationObserver;

	async onload() {
		await this.loadSettings();

		// Add settings tab
		this.addSettingTab(new RibbonHiderSettingTab(this.app, this));

		// Set up observer to only observe the ribbon containers (limiting scope to prevent side effects)
		this.setupObserver();

		// Apply initial hiding
		this.updateStyles();

		// Re-initialize the observer on workspace layout changes (covers rendering of new ribbons)
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.setupObserver();
				this.updateStyles();
			})
		);

		// Register contextmenu event listener on the document
		this.registerDomEvent(document, 'contextmenu', (event: MouseEvent) => {
			const label = this.resolveRibbonLabel(event.target);
			if (!label) return;

			// Intercept right click on a button
			event.preventDefault();
			this.showRibbonMenu(label, { x: event.clientX, y: event.clientY });
		});

		// Support touch-hold (long press) for mobile and iPad screens
		let touchTimeout: number | null = null;
		let touchStartX = 0;
		let touchStartY = 0;

		const cancelTouchHold = () => {
			if (touchTimeout !== null) {
				window.clearTimeout(touchTimeout);
				touchTimeout = null;
			}
		};

		this.registerDomEvent(document, 'touchstart', (event: TouchEvent) => {
			const label = this.resolveRibbonLabel(event.target);
			if (!label) return;

			const touch = event.touches[0];
			touchStartX = touch.clientX;
			touchStartY = touch.clientY;

			// Start a timer for a 600ms hold (long-press)
			touchTimeout = window.setTimeout(() => {
				touchTimeout = null;

				// Prevent default touch behaviors (like standard context menu)
				event.preventDefault();

				this.showRibbonMenu(label, { x: touch.clientX, y: touch.clientY });

				// Haptic vibration feedback on touch hold
				if (navigator.vibrate) {
					navigator.vibrate(50);
				}
			}, 600);
		});

		this.registerDomEvent(document, 'touchmove', (event: TouchEvent) => {
			if (touchTimeout === null) return;
			const touch = event.touches[0];
			// If touch moves significantly, cancel the hold detection
			if (Math.abs(touch.clientX - touchStartX) > 10 || Math.abs(touch.clientY - touchStartY) > 10) {
				cancelTouchHold();
			}
		});

		this.registerDomEvent(document, 'touchend', cancelTouchHold);
		this.registerDomEvent(document, 'touchcancel', cancelTouchHold);

		this.register(cancelTouchHold);
	}

	onunload() {
		// Disconnect DOM observer
		if (this.observer) {
			this.observer.disconnect();
		}

		// Restore visibility of all hidden buttons (scoped to ribbon containers to avoid touching unrelated elements)
		document.querySelectorAll<HTMLElement>(RIBBON_ITEMS).forEach((item) => {
			item.removeClass(HIDDEN_CLASS);
		});
	}

	/**
	 * Returns the aria-label of the hideable ribbon button containing `target`,
	 * or null when the event did not originate from one.
	 */
	resolveRibbonLabel(target: EventTarget | null): string | null {
		if (!(target instanceof HTMLElement)) return null;

		// Check if we are inside a ribbon container
		if (!target.closest(RIBBON_CONTAINERS)) return null;

		// Find the closest ribbon item/button
		const ribbonAction = target.closest(RIBBON_ACTIONS);
		if (!ribbonAction) return null;

		const label = ribbonAction.getAttribute('aria-label');
		if (!label || !isHideable(label)) return null;

		return label;
	}

	showRibbonMenu(label: string, position: MenuPositionDef) {
		const menu = new Menu();

		menu.addItem((item) => {
			item.setTitle(`Hide "${label}"`)
				.setIcon('eye-off')
				.onClick(async () => {
					await this.hideButton(label);
					new Notice(`Hid "${label}" button. Manage in Ribbon Hider settings.`);
				});
		});

		menu.addItem((item) => {
			item.setTitle('Ribbon Hider settings...')
				.setIcon('settings')
				.onClick(async () => {
					const setting = (this.app as AppWithSettingsModal).setting;
					if (!setting) return;
					await setting.open();
					setting.openTabById(this.manifest.id);
				});
		});

		menu.showAtPosition(position);
	}

	async loadSettings() {
		// loadData() is typed as `any`; narrow it before merging over the defaults.
		const stored = await this.loadData() as Partial<RibbonHiderSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	isHidden(label: string): boolean {
		return this.settings.hiddenButtons.includes(label);
	}

	async hideButton(label: string) {
		if (!this.isHidden(label)) {
			this.settings.hiddenButtons.push(label);
			await this.saveSettings();
			this.updateStyles();
		}
	}

	async unhideButton(label: string) {
		if (this.isHidden(label)) {
			this.settings.hiddenButtons = this.settings.hiddenButtons.filter(b => b !== label);
			await this.saveSettings();
			this.updateStyles();
		}
	}

	async unhideAll() {
		this.settings.hiddenButtons = [];
		await this.saveSettings();
		this.updateStyles();
	}

	/**
	 * Splits known labels into those currently rendered in the ribbon and those
	 * that are only remembered as hidden (e.g. from a since-disabled plugin).
	 */
	getRibbonLabels(): { active: string[]; inactive: string[] } {
		const domLabels = Array.from(
			document.querySelectorAll('.workspace-ribbon [aria-label], .side-dock-ribbon [aria-label]')
		)
			.map(item => item.getAttribute('aria-label'))
			.filter((label): label is string => !!label);

		// Deduplicate and filter out collapse/expand actions
		const active = Array.from(new Set(domLabels)).filter(isHideable);
		const inactive = this.settings.hiddenButtons.filter(label => !active.includes(label));

		return { active, inactive };
	}

	setupObserver() {
		// Disconnect existing observer if active
		if (this.observer) {
			this.observer.disconnect();
		}

		// Scope the MutationObserver specifically to ribbon containers
		const ribbonContainers = document.querySelectorAll(RIBBON_CONTAINERS);
		if (ribbonContainers.length > 0) {
			this.observer = new MutationObserver(() => {
				this.updateStyles();
			});
			ribbonContainers.forEach(container => {
				this.observer.observe(container, { childList: true, subtree: true });
			});
		} else {
			// Fallback: observe document.body until the ribbon containers are loaded in DOM
			this.observer = new MutationObserver(() => {
				if (document.querySelector(RIBBON_CONTAINERS)) {
					this.setupObserver();
					this.updateStyles();
				}
			});
			this.observer.observe(document.body, { childList: true, subtree: true });
		}
	}

	updateStyles() {
		// Limit changes to elements within the ribbon containers to prevent breaking properties UI or other views
		document.querySelectorAll<HTMLElement>(RIBBON_ITEMS).forEach((item) => {
			const label = item.getAttribute('aria-label');
			item.toggleClass(HIDDEN_CLASS, !!label && this.isHidden(label));
		});
	}
}

class RibbonHiderSettingTab extends PluginSettingTab {
	plugin: RibbonHiderPlugin;

	constructor(app: App, plugin: RibbonHiderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Declarative settings. The inherited `display()` renders from these, and
	 * Obsidian indexes them so the toggles show up in settings search.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const { active, inactive } = this.plugin.getRibbonLabels();

		const toggleFor = (label: string, desc: string): SettingDefinition => ({
			name: label,
			desc,
			control: { type: 'toggle', key: `${VISIBILITY_KEY_PREFIX}${label}` }
		});

		const definitions: SettingDefinitionGroup[] = [
			{
				type: 'group',
				items: [
					{
						name: 'How it works',
						desc: 'Right-click (or touch and hold) any ribbon button in the side panel to hide it. Use the toggles below to restore hidden buttons.'
					},
					{
						name: 'Unhide all buttons',
						desc: 'Restore visibility for all hidden ribbon buttons.',
						visible: () => this.plugin.settings.hiddenButtons.length > 0,
						render: (setting: Setting) => {
							setting.addButton(button => {
								button.setButtonText('Unhide all')
									.setCta()
									.onClick(async () => {
										await this.plugin.unhideAll();
										new Notice('All ribbon buttons unhidden.');
										this.update();
									});
							});
						}
					}
				]
			},
			{
				type: 'group',
				heading: 'Active ribbon buttons',
				items: active.length > 0
					? active.map(label =>
						toggleFor(label, this.plugin.isHidden(label) ? 'Currently hidden' : 'Currently visible'))
					: [{ name: 'No active ribbon buttons found.', searchable: false }]
			}
		];

		if (inactive.length > 0) {
			definitions.push({
				type: 'group',
				heading: 'Inactive hidden buttons',
				items: [
					{
						name: 'About these buttons',
						desc: 'These buttons were previously hidden but are not currently present in the ribbon (e.g. from disabled plugins).',
						searchable: false
					},
					...inactive.map(label => toggleFor(label, 'Not found in active ribbon'))
				]
			});
		}

		return definitions;
	}

	/** Maps a `visible:<label>` control key back to its ribbon label. */
	private labelForKey(key: string): string | null {
		return key.startsWith(VISIBILITY_KEY_PREFIX)
			? key.slice(VISIBILITY_KEY_PREFIX.length)
			: null;
	}

	getControlValue(key: string): unknown {
		const label = this.labelForKey(key);
		if (label === null) return super.getControlValue(key);
		// The toggle reads as "visible", the inverse of what we persist.
		return !this.plugin.isHidden(label);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const label = this.labelForKey(key);
		if (label === null) return super.setControlValue(key, value);

		if (value) {
			await this.plugin.unhideButton(label);
		} else {
			await this.plugin.hideButton(label);
		}

		// Unhiding an inactive button moves it between groups, so rebuild.
		this.update();
	}
}
