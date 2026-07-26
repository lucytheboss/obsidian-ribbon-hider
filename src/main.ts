import { App, Plugin, PluginSettingTab, Setting, Menu, Notice } from 'obsidian';

interface RibbonHiderSettings {
	hiddenButtons: string[];
}

const DEFAULT_SETTINGS: RibbonHiderSettings = {
	hiddenButtons: []
};

export default class RibbonHiderPlugin extends Plugin {
	settings: RibbonHiderSettings;
	observer: MutationObserver;

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
			const target = event.target as HTMLElement;

			// Check if we are inside a ribbon container
			const ribbonContainer = target.closest('.workspace-ribbon, .side-dock-ribbon');
			if (!ribbonContainer) return;

			// Find the closest ribbon item/button
			const ribbonAction = target.closest('.side-dock-ribbon-action, .workspace-ribbon-item, .clickable-icon');
			if (!ribbonAction) return;

			const label = ribbonAction.getAttribute('aria-label');
			if (!label) return;

			// Exclude collapse/expand buttons from hiding
			const lowerLabel = label.toLowerCase();
			if (lowerLabel.includes('collapse') || lowerLabel.includes('expand')) {
				return;
			}

			// Intercept right click on a button
			event.preventDefault();

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
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						const setting = (this.app as any).setting;
						if (setting) {
							// eslint-disable-next-line @typescript-eslint/no-unsafe-call
							await setting.open();
							// eslint-disable-next-line @typescript-eslint/no-unsafe-call
							setting.openTabById(this.manifest.id);
						}
					});
			});

			menu.showAtPosition(event);
		});

		// Support touch-hold (long press) for mobile and iPad screens
		let touchTimeout: any = null;
		let touchStartX = 0;
		let touchStartY = 0;

		this.registerDomEvent(document, 'touchstart', (event: TouchEvent) => {
			const target = event.target as HTMLElement;

			// Check if we are inside a ribbon container
			const ribbonContainer = target.closest('.workspace-ribbon, .side-dock-ribbon');
			if (!ribbonContainer) return;

			// Find the closest ribbon item/button
			const ribbonAction = target.closest('.side-dock-ribbon-action, .workspace-ribbon-item, .clickable-icon');
			if (!ribbonAction) return;

			const label = ribbonAction.getAttribute('aria-label');
			if (!label) return;

			// Exclude collapse/expand buttons from touch action
			const lowerLabel = label.toLowerCase();
			if (lowerLabel.includes('collapse') || lowerLabel.includes('expand')) {
				return;
			}

			const touch = event.touches[0];
			touchStartX = touch.clientX;
			touchStartY = touch.clientY;

			// Start a timer for a 600ms hold (long-press)
			touchTimeout = setTimeout(() => {
				// Prevent default touch behaviors (like standard context menu)
				event.preventDefault();

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
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							const setting = (this.app as any).setting;
							if (setting) {
								// eslint-disable-next-line @typescript-eslint/no-unsafe-call
								await setting.open();
								// eslint-disable-next-line @typescript-eslint/no-unsafe-call
								setting.openTabById(this.manifest.id);
							}
						});
				});

				// Display context menu at touch position
				menu.showAtPosition({ x: touch.clientX, y: touch.clientY });

				// Haptic vibration feedback on touch hold
				if (navigator.vibrate) {
					navigator.vibrate(50);
				}
			}, 600);
		});

		this.registerDomEvent(document, 'touchmove', (event: TouchEvent) => {
			if (touchTimeout) {
				const touch = event.touches[0];
				// If touch moves significantly, cancel the hold detection
				if (Math.abs(touch.clientX - touchStartX) > 10 || Math.abs(touch.clientY - touchStartY) > 10) {
					clearTimeout(touchTimeout);
					touchTimeout = null;
				}
			}
		});

		this.registerDomEvent(document, 'touchend', () => {
			if (touchTimeout) {
				clearTimeout(touchTimeout);
				touchTimeout = null;
			}
		});

		this.registerDomEvent(document, 'touchcancel', () => {
			if (touchTimeout) {
				clearTimeout(touchTimeout);
				touchTimeout = null;
			}
		});
	}

	onunload() {
		// Disconnect DOM observer
		if (this.observer) {
			this.observer.disconnect();
		}

		// Restore visibility of all hidden buttons (scoped to ribbon containers to avoid touching unrelated elements)
		const items = document.querySelectorAll('.workspace-ribbon .workspace-ribbon-item, .workspace-ribbon .clickable-icon, .side-dock-ribbon .side-dock-ribbon-action, .side-dock-ribbon .clickable-icon');
		items.forEach((item) => {
			const htmlItem = item as HTMLElement;
			if (htmlItem.style.display === 'none') {
				htmlItem.style.removeProperty('display');
			}
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async hideButton(label: string) {
		if (!this.settings.hiddenButtons.includes(label)) {
			this.settings.hiddenButtons.push(label);
			await this.saveSettings();
			this.updateStyles();
		}
	}

	async unhideButton(label: string) {
		if (this.settings.hiddenButtons.includes(label)) {
			this.settings.hiddenButtons = this.settings.hiddenButtons.filter(b => b !== label);
			await this.saveSettings();
			this.updateStyles();
		}
	}

	setupObserver() {
		// Disconnect existing observer if active
		if (this.observer) {
			this.observer.disconnect();
		}

		// Scope the MutationObserver specifically to ribbon containers
		const ribbonContainers = document.querySelectorAll('.workspace-ribbon, .side-dock-ribbon');
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
				const ribbonExists = document.querySelector('.workspace-ribbon, .side-dock-ribbon');
				if (ribbonExists) {
					this.setupObserver();
					this.updateStyles();
				}
			});
			this.observer.observe(document.body, { childList: true, subtree: true });
		}
	}

	updateStyles() {
		// Limit style modifications to elements within the ribbon containers to prevent breaking properties UI or other views
		const items = document.querySelectorAll('.workspace-ribbon .workspace-ribbon-item, .workspace-ribbon .clickable-icon, .side-dock-ribbon .side-dock-ribbon-action, .side-dock-ribbon .clickable-icon');
		items.forEach((item) => {
			const htmlItem = item as HTMLElement;
			const label = htmlItem.getAttribute('aria-label');
			if (label && this.settings.hiddenButtons.includes(label)) {
				htmlItem.style.setProperty('display', 'none', 'important');
			} else {
				if (htmlItem.style.display === 'none') {
					htmlItem.style.removeProperty('display');
				}
			}
		});
	}
}

class RibbonHiderSettingTab extends PluginSettingTab {
	plugin: RibbonHiderPlugin;

	constructor(app: App, plugin: RibbonHiderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Ribbon Hider Settings').setHeading();
		
		containerEl.createEl('p', { 
			text: 'Right-click any ribbon button in the left-side panel to hide it. Use the options below to restore hidden buttons.',
			cls: 'setting-item-description'
		});

		// Unhide all buttons helper
		if (this.plugin.settings.hiddenButtons.length > 0) {
			new Setting(containerEl)
				.setName('Unhide all buttons')
				.setDesc('Restore visibility for all hidden ribbon buttons.')
				.addButton(button => {
					button.setButtonText('Unhide All')
						.setCta()
						.onClick(async () => {
							this.plugin.settings.hiddenButtons = [];
							await this.plugin.saveSettings();
							this.plugin.updateStyles();
							new Notice('All ribbon buttons unhidden.');
							this.display();
						});
				});
		}

		// Scan the workspace ribbon in DOM
		const ribbonItems = Array.from(
			document.querySelectorAll('.workspace-ribbon [aria-label], .side-dock-ribbon [aria-label]')
		);
		const domLabels = ribbonItems
			.map(item => item.getAttribute('aria-label'))
			.filter(Boolean) as string[];

		// Deduplicate and filter out collapse/expand actions
		const uniqueDomLabels = Array.from(new Set(domLabels)).filter(label => {
			const lower = label.toLowerCase();
			return !lower.includes('collapse') && !lower.includes('expand');
		});

		// Find hidden buttons that are not currently in the DOM (e.g. disabled plugins)
		const inactiveLabels = this.plugin.settings.hiddenButtons.filter(
			label => !uniqueDomLabels.includes(label)
		);

		new Setting(containerEl).setName('Active Ribbon Buttons').setHeading();

		if (uniqueDomLabels.length === 0) {
			containerEl.createEl('p', { text: 'No active ribbon buttons found.', cls: 'setting-item-description' });
		} else {
			for (const label of uniqueDomLabels) {
				const isHidden = this.plugin.settings.hiddenButtons.includes(label);
				new Setting(containerEl)
					.setName(label)
					.setDesc(isHidden ? 'Currently hidden' : 'Currently visible')
					.addToggle(toggle => {
						toggle.setValue(!isHidden)
							.onChange(async (value) => {
								if (value) {
									await this.plugin.unhideButton(label);
								} else {
									await this.plugin.hideButton(label);
								}
								this.display();
							});
					});
			}
		}

		if (inactiveLabels.length > 0) {
			new Setting(containerEl).setName('Inactive Hidden Buttons').setHeading();
			
			containerEl.createEl('p', { 
				text: 'These buttons were previously hidden but are not currently present in the ribbon (e.g., from disabled plugins).',
				cls: 'setting-item-description'
			});

			for (const label of inactiveLabels) {
				new Setting(containerEl)
					.setName(label)
					.setDesc('Not found in active ribbon')
					.addToggle(toggle => {
						toggle.setValue(false) // It's hidden
							.onChange(async (value) => {
								if (value) {
									// Turning it "ON" means unhide / remove from hidden list
									await this.plugin.unhideButton(label);
									this.display();
								}
							});
					});
			}
		}
	}
}
