import os
import sys
import requests
from uuid import uuid1
from subprocess import call, CREATE_NO_WINDOW
from PyQt5.QtCore import QThread, pyqtSignal, QSize, Qt, QTimer
from PyQt5.QtWidgets import (
    QWidget, QHBoxLayout, QVBoxLayout, QLabel, QLineEdit, QComboBox,
    QProgressBar, QPushButton, QApplication, QMainWindow, QDialog, QTextEdit, QCheckBox, QSlider
)
from PyQt5.QtGui import QPixmap
from minecraft_launcher_lib.utils import get_minecraft_directory, get_version_list
from minecraft_launcher_lib.install import install_minecraft_version
from minecraft_launcher_lib.command import get_minecraft_command
from minecraft_launcher_lib.fabric import install_fabric
from minecraft_launcher_lib.quilt import install_quilt
from random_username.generate import generate_username
from pypresence import Presence

def resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

def is_internet_connected():
    try:
        requests.get('http://www.google.com', timeout=5)
        return True
    except requests.ConnectionError:
        return False

minecraft_directory = get_minecraft_directory().replace('minecraft', 'xneonlauncher')

def get_settings_directory():
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    else:
        return os.path.dirname(os.path.abspath(__file__))

def fetch_quilt_versions():
    url = "https://meta.quiltmc.org/v3/versions/game"
    try:
        response = requests.get(url)
        if response.status_code == 200:
            return [version['version'] for version in response.json()]
        else:
            print("Failed to fetch Quilt versions")
            return []
    except requests.RequestException as e:
        print(f"Error fetching Quilt versions: {e}")
        return []

class LaunchThread(QThread):
    launch_setup_signal = pyqtSignal(str, str, bool, int)
    progress_update_signal = pyqtSignal(int, int, str)
    state_update_signal = pyqtSignal(bool)
    finished_signal = pyqtSignal()

    def __init__(self):
        super().__init__()
        self.launch_setup_signal.connect(self.launch_setup)
        self.version_id = ''
        self.username = ''
        self.show_console = True
        self.memory = 2

    def launch_setup(self, version_id, username, show_console, memory):
        self.version_id = version_id
        self.username = username
        self.show_console = show_console
        self.memory = memory

    def update_progress(self, value, maximum, label):
        self.progress_update_signal.emit(value, maximum, label)

    def run(self):
        self.state_update_signal.emit(True)
        install_minecraft_version(
            versionid=self.version_id,
            minecraft_directory=minecraft_directory,
            callback={
                'setStatus': lambda v: self.update_progress(0, 0, v),
                'setProgress': lambda v: self.update_progress(v, 0, ''),
                'setMax': lambda v: self.update_progress(0, v, '')
            }
        )
        if not self.username:
            self.username = generate_username()[0]
        options = {
            'username': self.username, 
            'uuid': str(uuid1()), 
            'token': '',
            'jvmArguments': [f"-Xmx{self.memory}G", f"-Xms{self.memory}G"]
        }
        creationflags = 0 if self.show_console else CREATE_NO_WINDOW
        call(get_minecraft_command(version=self.version_id, minecraft_directory=minecraft_directory, options=options), creationflags=creationflags)
        self.state_update_signal.emit(False)
        self.finished_signal.emit()

class FabricInstallThread(QThread):
    install_complete_signal = pyqtSignal(bool, str)
    progress_update_signal = pyqtSignal(int, int, str)

    def __init__(self, version_id, minecraft_directory):
        super().__init__()
        self.version_id = version_id
        self.minecraft_directory = minecraft_directory

    def update_progress(self, value, maximum, label):
        self.progress_update_signal.emit(value, maximum, label)

    def run(self):
        fabric_version_id = f"fabric-loader-0.16.4-{self.version_id}"
        version_path = os.path.join(self.minecraft_directory, "versions", fabric_version_id)
        if os.path.exists(version_path):
            self.install_complete_signal.emit(True, fabric_version_id)
            return
        try:
            install_fabric(self.version_id, self.minecraft_directory, callback={
                'setStatus': lambda v: self.update_progress(0, 0, v),
                'setProgress': lambda v: self.update_progress(v, 0, ''),
                'setMax': lambda v: self.update_progress(0, v, '')
            })
            self.install_complete_signal.emit(True, fabric_version_id)
        except Exception:
            self.install_complete_signal.emit(False, "")

class QuiltInstallThread(QThread):
    install_complete_signal = pyqtSignal(bool, str)
    progress_update_signal = pyqtSignal(int, int, str)

    def __init__(self, version_id, minecraft_directory):
        super().__init__()
        self.version_id = version_id
        self.minecraft_directory = minecraft_directory

    def update_progress(self, value, maximum, label):
        self.progress_update_signal.emit(value, maximum, label)

    def run(self):
        quilt_version_id = f"quilt-loader-0.26.4-beta.5-{self.version_id}"
        version_path = os.path.join(self.minecraft_directory, "versions", quilt_version_id)
        if os.path.exists(version_path):
            self.install_complete_signal.emit(True, quilt_version_id)
            return
        try:
            install_quilt(self.version_id, self.minecraft_directory, callback={
                'setStatus': lambda v: self.update_progress(0, 0, v),
                'setProgress': lambda v: self.update_progress(v, 0, ''),
                'setMax': lambda v: self.update_progress(0, v, '')
            })
            self.install_complete_signal.emit(True, quilt_version_id)
        except Exception:
            self.install_complete_signal.emit(False, "")

class NewsDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Новости")
        self.setFixedSize(400, 300)
        layout = QVBoxLayout()
        self.text_edit = QTextEdit(readOnly=True)
        layout.addWidget(self.text_edit)
        self.setLayout(layout)
        self.load_readme_content()

    def load_readme_content(self):
        url = "https://raw.githubusercontent.com/MAINER4IK/Xneon-Launcher/main/README.md"
        try:
            response = requests.get(url)
            if response.status_code == 200:
                self.text_edit.setMarkdown(response.text)
            else:
                self.text_edit.setText("Не удалось загрузить новостное содержание.")
        except requests.RequestException:
            self.text_edit.setText("Ошибка при загрузке новостей.")

class NoInternetDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Нет подключения к интернету")
        self.setFixedSize(300, 50)
        layout = QVBoxLayout()
        self.label = QLabel("<b>Включите интернет и перезапустите лаунчер.</b>")
        layout.addWidget(self.label)
        self.setLayout(layout)

    def keyPressEvent(self, event):
        if event.key() in (Qt.Key_Return, Qt.Key_Enter):
            self.accept()

class SettingsDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle(parent.translations.get('settings', 'Settings'))
        self.setFixedSize(300, 250)
        layout = QVBoxLayout()

        self.language_select = QComboBox(self)
        self.language_select.addItems(['English', 'Русский'])
        self.language_select.currentIndexChanged.connect(self.change_language)

        layout.addWidget(QLabel(parent.translations.get('language_label', 'Язык / Language:'), self))
        layout.addWidget(self.language_select)

        self.open_folder_button = QPushButton(parent.translations.get('open_folder', 'Open Launcher Folder'), self)
        self.open_folder_button.clicked.connect(self.open_minecraft_folder)

        self.console_checkbox = QCheckBox(parent.translations.get('show_console', 'Show console when launching Minecraft'), self)
        self.slider_label = QLabel("", self)
        self.slider = QSlider(Qt.Horizontal, self)
        self.slider.setRange(2, 16)
        self.slider.setTickInterval(2)
        self.slider.setTickPosition(QSlider.TicksAbove)
        self.slider.setSingleStep(2)
        self.slider.valueChanged.connect(self.update_slider_label)

        layout.addWidget(self.open_folder_button)
        layout.addWidget(self.console_checkbox)
        layout.addWidget(self.slider_label)
        layout.addWidget(self.slider)
        self.setLayout(layout)

        self.load_console_checkbox_state()
        self.load_slider_value()
        self.load_language_setting()
        self.update_translations()

    def update_translations(self):
        translations = self.parent().translations
        self.setWindowTitle(translations.get('settings', 'Settings'))
        self.open_folder_button.setText(translations.get('open_folder', 'Open Launcher Folder'))
        self.console_checkbox.setText(translations.get('show_console', 'Show console when launching Minecraft'))
        self.update_slider_label(self.slider.value())

    def change_language(self):
        language = 'ru' if self.language_select.currentIndex() == 1 else 'en'
        self.parent().set_language(language)
        self.update_translations()

    def open_minecraft_folder(self):
        os.startfile(minecraft_directory)

    def load_console_checkbox_state(self):
        state = self.load_setting('show_console')
        self.console_checkbox.setChecked(state.lower() == 'true' if state else True)

    def save_console_checkbox_state(self):
        self.save_setting('show_console', 'true' if self.console_checkbox.isChecked() else 'false')

    def load_slider_value(self):
        value = self.load_setting('memory')
        if value.isdigit():
            self.slider.setValue(int(value))
        else:
            self.slider.setValue(2)

    def save_slider_value(self):
        self.save_setting('memory', str(self.slider.value()))

    def update_slider_label(self, value):
        translations = self.parent().translations
        label_text = translations.get('ram_allocated', 'RAM allocated: {} GB').format(value)
        self.slider_label.setText(label_text)

    def load_language_setting(self):
        language = self.load_setting('language')
        if language == 'ru':
            self.language_select.setCurrentIndex(1)
        else:
            self.language_select.setCurrentIndex(0)

    def save_language_setting(self):
        language = 'ru' if self.language_select.currentIndex() == 1 else 'en'
        self.save_setting('language', language)

    def accept(self):
        self.save_language_setting()
        self.save_console_checkbox_state()
        self.save_slider_value()
        super().accept()

    def load_setting(self, key):
        settings_path = os.path.join(get_settings_directory(), 'settings.txt')
        if os.path.exists(settings_path):
            with open(settings_path, 'r') as file:
                settings = dict(line.strip().split('=') for line in file if '=' in line)
                return settings.get(key, '')
        return ''

    def save_setting(self, key, value):
        settings_path = os.path.join(get_settings_directory(), 'settings.txt')
        settings = {}
        if os.path.exists(settings_path):
            with open(settings_path, 'r') as file:
                settings = dict(line.strip().split('=') for line in file if '=' in line)
        settings[key] = value
        with open(settings_path, 'w') as file:
            for k, v in settings.items():
                file.write(f"{k}={v}\n")

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        if not is_internet_connected():
            self.no_internet_dialog = NoInternetDialog(self)
            self.no_internet_dialog.exec_()
            exit()

        self.language = 'en'
        self.translations = self.load_translations(self.language)

        self.setFixedSize(286, 180)
        self.setWindowTitle("Xneon Launcher 1.4")
        self.centralwidget = QWidget(self)
        self.setup_ui()
        self.launch_thread = LaunchThread()
        self.launch_thread.state_update_signal.connect(self.state_update)
        self.launch_thread.progress_update_signal.connect(self.update_progress)
        self.launch_thread.finished_signal.connect(self.on_game_finished)
        self.version_list = get_version_list()
        self.update_version_list()
        self.ensure_minecraft_folder_exists()
        self.setup_discord_rpc()

        self.settings_dialog = SettingsDialog(self)

        self.load_settings()

    def load_translations(self, language_code):
        translations = {
            'en': {
                'settings': 'Settings',
                'language_label': 'Language:',
                'open_folder': 'Open Launcher Folder',
                'show_console': 'Show console when launching Minecraft',
                'ram_allocated': 'RAM allocated: {} GB',
                'username_placeholder': 'Enter username',
                'play': 'Play',
                'news_button_tooltip': 'Show News',
                'waiting': 'Waiting to play...',
                'site_button': 'Visit our site'
            },
            'ru': {
                'settings': 'Настройки',
                'language_label': 'Язык:',
                'open_folder': 'Открыть папку лаунчера',
                'show_console': 'Показывать консоль при запуске Minecraft',
                'ram_allocated': 'Выделено RAM: {} ГБ',
                'username_placeholder': 'Введите имя пользователя',
                'play': 'Играть',
                'news_button_tooltip': 'Показать новости',
                'waiting': 'Ожидание запуска...',
                'site_button': 'Посетите наш сайт'
            }
        }
        return translations.get(language_code, translations['en'])

    def set_language(self, language):
        self.language = language
        self.translations = self.load_translations(self.language)
        self.update_translations()
        if hasattr(self, 'settings_dialog'):
            self.settings_dialog.update_translations()

    def setup_ui(self):
        self.logo = QLabel(self.centralwidget)
        self.logo.setMaximumSize(QSize(256, 37))
        self.logo.setPixmap(QPixmap(resource_path('assets\\title.png')))
        self.logo.setScaledContents(True)

        self.username = QLineEdit(self.centralwidget)
        self.username.setPlaceholderText(self.translations.get('username_placeholder', ''))

        self.version_select = QComboBox(self.centralwidget)
        self.mod_loader_select = QComboBox(self.centralwidget)
        self.mod_loader_select.addItems(['Vanilla', 'Fabric', 'Quilt'])
        self.mod_loader_select.currentIndexChanged.connect(self.update_version_list)

        self.start_progress_label = QLabel(self.centralwidget)
        self.start_progress_label.setVisible(False)
        self.start_progress = QProgressBar(self.centralwidget)
        self.start_progress.setVisible(False)

        self.start_button = QPushButton(self.translations.get('play', ''), self.centralwidget)
        self.start_button.clicked.connect(self.launch_game)

        self.settings_button = QPushButton(self.translations.get('settings', ''), self.centralwidget)
        self.settings_button.clicked.connect(self.open_settings_dialog)

        self.layout_ui()

    def layout_ui(self):
        vertical_layout = QVBoxLayout(self.centralwidget)
        vertical_layout.setContentsMargins(15, 15, 15, 15)
        vertical_layout.addWidget(self.logo, 0, Qt.AlignmentFlag.AlignHCenter)
        vertical_layout.addWidget(self.username)
        vertical_layout.addWidget(self.version_select)
        vertical_layout.addWidget(self.mod_loader_select)
        vertical_layout.addWidget(self.start_progress_label)
        vertical_layout.addWidget(self.start_progress)

        horizontal_layout = QHBoxLayout()
        horizontal_layout.addWidget(self.start_button)
        horizontal_layout.addWidget(self.settings_button)

        vertical_layout.addLayout(horizontal_layout)
        self.setCentralWidget(self.centralwidget)

        self.setup_title_bar()

    def setup_title_bar(self):
        self.title_bar_widget = QWidget(self)
        self.title_bar_layout = QHBoxLayout(self.title_bar_widget)
        self.title_bar_widget.setFixedHeight(30)
        self.title_bar_widget.move(0, 0)
        self.title_bar_widget.resize(self.width(), 30)

        self.news_button = QPushButton("?", self.title_bar_widget)
        self.news_button.setFixedSize(30, 22)
        self.news_button.setToolTip(self.translations.get('news_button_tooltip', ''))
        self.news_button.clicked.connect(self.show_news)

        self.title_bar_layout.addStretch()
        self.title_bar_layout.addWidget(self.news_button)
        self.title_bar_widget.raise_()

    def update_translations(self):
        self.username.setPlaceholderText(self.translations.get('username_placeholder', ''))
        self.start_button.setText(self.translations.get('play', ''))
        self.settings_button.setText(self.translations.get('settings', ''))
        self.news_button.setToolTip(self.translations.get('news_button_tooltip', ''))

    def update_version_list(self):
        selected_loader = self.mod_loader_select.currentText()
        self.version_select.clear()

        fabric_supported_versions = [f'1.{i}' for i in range(14, 22)]
        quilt_supported_versions = fetch_quilt_versions()

        versions = [
            f"{v['id']} (snapshot)" if v['type'] == 'snapshot' else v['id']
            for v in self.version_list if v['type'] in ['release', 'snapshot', 'old_alpha', 'old_beta']
            and (
                selected_loader == 'Vanilla' or
                (selected_loader == 'Fabric' and any(v['id'].startswith(ver) for ver in fabric_supported_versions)) or
                (selected_loader == 'Quilt' and v['id'] in quilt_supported_versions)
            )
        ]

        self.version_select.addItems(versions or [self.translations.get('no_versions', '')])
        saved_version = self.load_setting('version')
        if saved_version:
            version_index = self.version_select.findText(saved_version)
            if version_index != -1:
                self.version_select.setCurrentIndex(version_index)

    def state_update(self, value):
        self.start_button.setDisabled(value)
        self.start_progress_label.setVisible(value)
        self.start_progress.setVisible(value)
        self.setFixedSize(300, 230 if value else 180)

    def update_progress(self, value, maximum, label):
        self.start_progress.setMaximum(maximum)
        self.start_progress.setValue(value)
        self.start_progress_label.setText(label)

    def ensure_minecraft_folder_exists(self):
        os.makedirs(minecraft_directory, exist_ok=True)

    def open_settings_dialog(self):
        if self.settings_dialog.exec_() == QDialog.Accepted:
            self.settings_dialog.save_console_checkbox_state()
            self.settings_dialog.save_slider_value()

    def launch_game(self):
        version_id = self.version_select.currentText().split(' ')[0]
        self.current_version_playing = version_id
        username = self.username.text()
        show_console = self.settings_dialog.console_checkbox.isChecked()
        mod_loader = self.mod_loader_select.currentText()
        memory = self.settings_dialog.slider.value()

        if mod_loader == 'Fabric':
            self.fabric_install_thread = FabricInstallThread(version_id, minecraft_directory)
            self.fabric_install_thread.install_complete_signal.connect(self.on_fabric_install_complete)
            self.fabric_install_thread.progress_update_signal.connect(self.update_progress)
            self.state_update(True)
            self.fabric_install_thread.start()
        elif mod_loader == 'Quilt':
            self.quilt_install_thread = QuiltInstallThread(version_id, minecraft_directory)
            self.quilt_install_thread.install_complete_signal.connect(self.on_quilt_install_complete)
            self.quilt_install_thread.progress_update_signal.connect(self.update_progress)
            self.state_update(True)
            self.quilt_install_thread.start()
        else:
            self.launch_thread.launch_setup(version_id, username, show_console, memory)
            self.launch_thread.start()

    def on_fabric_install_complete(self, success, fabric_version_id):
        if success:
            self.launch_thread.launch_setup(fabric_version_id, self.username.text(), self.settings_dialog.console_checkbox.isChecked(), self.settings_dialog.slider.value())
            self.launch_thread.start()
        self.state_update(False)

    def on_quilt_install_complete(self, success, quilt_version_id):
        if success:
            self.launch_thread.launch_setup(quilt_version_id, self.username.text(), self.settings_dialog.console_checkbox.isChecked(), self.settings_dialog.slider.value())
            self.launch_thread.start()
        self.state_update(False)

    def on_game_finished(self):
        self.current_version_playing = None
        self.update_discord_rpc()

    def show_news(self):
        self.news_dialog = NewsDialog(self)
        self.news_dialog.exec_()

    def setup_discord_rpc(self):
        CLIENT_ID = '1279183673660538972'
        try:
            self.discord_rpc = Presence(CLIENT_ID)
            self.discord_rpc.connect()
            self.rpc_timer = QTimer(self)
            self.rpc_timer.timeout.connect(self.update_discord_rpc)
            self.rpc_timer.start(30000)
            self.update_discord_rpc()
        except Exception:
            pass

    def update_discord_rpc(self):
        if hasattr(self, 'discord_rpc') and self.discord_rpc:
            try:
                if hasattr(self, 'current_version_playing') and self.current_version_playing:
                    current_version = self.current_version_playing
                    mod_loader = self.mod_loader_select.currentText()

                    if mod_loader != 'Vanilla':
                        state_text = f"Играет на версии {current_version}"
                        small_image_key = 'fabric_icon' if mod_loader == 'Fabric' else 'quilt_icon' if mod_loader == 'Quilt' else None
                        mod_count = self.get_mod_count()
                        small_text = f"Установлено {mod_count} модов"
                    else:
                        state_text = f"Играет на версии {current_version}"
                        small_image_key = None
                        small_text = None

                    self.discord_rpc.update(
                        state=state_text,
                        details="Запущен Xneon Launcher",
                        large_image="https://i.imgur.com/1u1oHSS.png",
                        small_image=small_image_key,
                        small_text=small_text,
                        buttons=[{"label": "Посетите наш сайт", "url": "https://activator.xneon.fun"}]
                    )
                else:
                    self.discord_rpc.update(
                        state="Ожидание запуска...",
                        details="Запущен Xneon Launcher",
                        large_image="https://i.imgur.com/1u1oHSS.png",
                        buttons=[{"label": "Посетите наш сайт", "url": "https://activator.xneon.fun"}]
                    )
            except Exception:
                pass

    def get_mod_count(self):
        mods_directory = os.path.join(minecraft_directory, 'mods')
        if not os.path.exists(mods_directory):
            return 0
        mod_files = [f for f in os.listdir(mods_directory) if f.endswith('.jar')]
        return len(mod_files)

    def closeEvent(self, event):
        self.save_settings()
        if hasattr(self, 'discord_rpc') and self.discord_rpc:
            self.discord_rpc.close()
        event.accept()

    def save_settings(self):
        try:
            settings = {
                'username': self.username.text(),
                'show_console': self.settings_dialog.console_checkbox.isChecked(),
                'memory': self.settings_dialog.slider.value(),
                'mod_loader': self.mod_loader_select.currentText(),
                'version': self.version_select.currentText().split(' ')[0],
                'language': self.language
            }
            settings_path = os.path.join(get_settings_directory(), 'settings.txt')
            with open(settings_path, 'w') as file:
                for key, value in settings.items():
                    file.write(f"{key}={value}\n")
        except Exception as e:
            print(f"Ошибка при сохранении настроек: {e}")

    def load_settings(self):
        settings_path = os.path.join(get_settings_directory(), 'settings.txt')
        if os.path.exists(settings_path):
            try:
                with open(settings_path, 'r') as file:
                    settings = dict(line.strip().split('=') for line in file if '=' in line)
                    self.username.setText(settings.get('username', ''))
                    self.settings_dialog.console_checkbox.setChecked(settings.get('show_console', 'True') == 'True')
                    self.settings_dialog.slider.setValue(int(settings.get('memory', '2')))
                    
                    mod_loader = settings.get('mod_loader', 'Vanilla')
                    mod_loader_index = self.mod_loader_select.findText(mod_loader)
                    if mod_loader_index != -1:
                        self.mod_loader_select.setCurrentIndex(mod_loader_index)
                    
                    saved_version = settings.get('version', '')
                    version_index = self.version_select.findText(saved_version)
                    if version_index != -1:
                        self.version_select.setCurrentIndex(version_index)

                    self.set_language(settings.get('language', 'en'))
            except Exception as e:
                print(f"Ошибка при загрузке настроек: {e}")

    def load_setting(self, key):
        settings_path = os.path.join(get_settings_directory(), 'settings.txt')
        if os.path.exists(settings_path):
            with open(settings_path, 'r') as file:
                settings = dict(line.strip().split('=') for line in file if '=' in line)
                return settings.get(key, '')
        return ''

if __name__ == '__main__':
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec_())
