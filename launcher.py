

CTk.CTkLabel(settings_frame, text="Выберите модлоадер:").place(x=10, y=120)

loader_combobox = CTk.CTkComboBox(settings_frame, values=["Vanilla", "Forge", "Fabric", "Quilt", "Clients"], command=update_loader, state='readonly')
loader_combobox.place(x=10, y=150)
loader_combobox.set(selected_loader)
hide_console_var = CTk.BooleanVar(value=True)
hide_console_checkbox = CTk.CTkCheckBox(settings_frame, text="Скрыть консоль", variable=hide_console_var)
hide_console_checkbox.place(x=10, y=200)

CTk.CTkLabel(settings_frame, text="Скрыть версии:").place(x=10, y=230)

hide_old_beta_checkbox = CTk.CTkCheckBox(settings_frame, text="Убрать Beta", variable=hide_old_beta, command=load_versions)
hide_old_beta_checkbox.place(x=10, y=260)
hide_release_checkbox = CTk.CTkCheckBox(settings_frame, text="Убрать Release", variable=hide_release, command=load_versions)
hide_release_checkbox.place(x=10, y=290)
hide_snapshot_checkbox = CTk.CTkCheckBox(settings_frame, text="Убрать Snapshot", variable=hide_snapshot, command=load_versions)
hide_snapshot_checkbox.place(x=10, y=320)
hide_old_alpha_checkbox = CTk.CTkCheckBox(settings_frame, text="Убрать Alpha", variable=hide_old_alpha, command=load_versions)
hide_old_alpha_checkbox.place(x=10, y=350)

def load_settings_from_file():
    global selected_ram, selected_loader, custom_minecraft_directory
    if os.path.exists(settings_file):
        with open(settings_file, "r") as file:
            settings = json.load(file)
            selected_ram = settings.get("ram", max_ram // 2)
            selected_loader = settings.get("loader", "Vanilla")
            custom_minecraft_directory.set(settings.get("custom_minecraft_directory", os.path.join(os.path.expanduser("~"), ".minecraft")))

def open_directory_selection_dialog():
    dialog = CTk.CTkToplevel(app)
    dialog.title("Кастомный путь")
    dialog.geometry("300x200")
    dialog.resizable(False, False)
    current_path_label = CTk.CTkLabel(dialog, text="", wraplength=250)
    current_path_label.pack(pady=10)

    def select_directory():
        directory = filedialog.askdirectory()
        if directory:
            custom_minecraft_directory.set(directory)
            current_path_label.configure(text=directory)

    def save_directory():
        save_settings()
        dialog.destroy()

    CTk.CTkButton(dialog, text="Выбрать путь", command=select_directory).pack(pady=10)
    CTk.CTkButton(dialog, text="Сохранить", command=save_directory).pack(pady=10)

    current_path_label.configure(text=custom_minecraft_directory.get())

CTk.CTkButton(settings_frame, text="📂", command=open_directory_selection_dialog, width=30, height=30).place(x=350, y=10)

load_settings_from_file()

save_button = CTk.CTkButton(settings_frame, text="Сохранить", command=save_settings)
save_button.place(x=10, y=410)
frame_news = CTk.CTkFrame(master=app, width=400, height=420, corner_radius=10)
frame_news.place(x=5, y=5)
newsTextbox = CTk.CTkTextbox(master=frame_news, wrap="word", width=380, height=360, state="normal")
newsTextbox.pack(pady=10)

def disable_selection(event):
    return "break"

newsTextbox.bind("<ButtonPress>", disable_selection)
newsTextbox.bind("<KeyPress>", disable_selection)
newsTextbox.configure(state="disabled")

warning_label = CTk.CTkLabel(app, text="", text_color="red")
warning_label.place(x=5, y=435)
version_combobox = CTk.CTkComboBox(master=app, values=[], variable=versions_combobox_startvar)
version_combobox.place(x=540, y=450)
NickName = CTk.CTkEntry(master=app, placeholder_text="Username")
NickName.place(x=690, y=450)
play_button = CTk.CTkButton(master=app, text="Играть", command=launch_game, width=70)
play_button.place(x=835, y=450)

account_manager_button = CTk.CTkButton(
    master=settings_frame, text="👤", command=open_account_manager, width=30, height=30
)
account_manager_button.place(x=420, y=10)

icon = pystray.Icon("Xneon Launcher")
icon.icon = Image.open(icon_path)
icon.title = "Xneon Launcher"
icon.menu = pystray.Menu(
    pystray.MenuItem("Показать", lambda: app.deiconify()),
    pystray.MenuItem("Выход", lambda: (icon.stop(), app.quit()))
)

def run_tray():
    icon.run()

tray_thread = threading.Thread(target=run_tray, daemon=True)
tray_thread.start()

def close_app():
    app.withdraw()

app.protocol("WM_DELETE_WINDOW", close_app)

def disable_controls():
    version_combobox.configure(state="disabled")
    loader_combobox.configure(state="disabled")
    play_button.configure(state="disabled")

def enable_controls():
    version_combobox.configure(state="normal")
    loader_combobox.configure(state="normal")
    play_button.configure(state="normal")

def run_application():
    if wait_for_authorization():
        load_settings()
        accounts = load_accounts()
        check_internet_connection()
        setup_discord_rpc()
        app.mainloop()

if __name__ == "__main__":
    run_application()
