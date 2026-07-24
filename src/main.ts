import { App, Plugin, PluginSettingTab, Setting, Menu, Notice } from 'obsidian';

interface RibbonHiderSettings {
	hiddenButtons: string[];
}

const DEFAULT_SETTINGS: RibbonHiderSettings = {
	hiddenButtons: []
};

export default class RibbonHiderPlugin extends Plugin {
	settings: RibbonHiderSettings;
	styleEl: HTMLStyleElement;

	async onload() {
		await this.loadSettings();

		// Add settings tab
		this.addSettingTab(new RibbonHiderSettingTab(this.app, this));

		// Initialize styles for hiding elements
		this.styleEl = document.createElement('style');
		this.styleEl.id = 'obsidian-ribbon-hider-styles';
		document.head.appendChild(this.styleEl);
		this.updateStyles();

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
						const setting = (this.app as any).setting;
						if (setting) {
							await setting.open();
							setting.openTabById(this.manifest.id);
						}
					});
			});

			menu.showAtPosition(event);
		});
	}

	onunload() {
		// Clean up injected style element
		if (this.styleEl) {
			this.styleEl.remove();
		}
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

	updateStyles() {
		let css = '';
		for (const label of this.settings.hiddenButtons) {
			const escapedLabel = label.replace(/"/g, '\\"');
			css += `.workspace-ribbon [aria-label="${escapedLabel}"], .side-dock-ribbon [aria-label="${escapedLabel}"] { display: none !important; }\n`;
		}
		this.styleEl.textContent = css;
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

		containerEl.createEl('h2', { text: 'Ribbon Hider Settings' });
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

		containerEl.createEl('h3', { text: 'Active Ribbon Buttons' });

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
			containerEl.createEl('h3', { text: 'Inactive Hidden Buttons' });
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
