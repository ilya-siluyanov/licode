import time
import sys
from selenium.webdriver import Chrome, ChromeOptions, ChromeService


path = sys.argv[1]

options = ChromeOptions()
options.add_argument("use-fake-device-for-media-stream")
options.add_argument("use-fake-ui-for-media-stream")

service = ChromeService(executable_path='/Users/ilyasiluyanov/Downloads/yandexdriver')
driver = Chrome(options=options, service=service)
driver.get("https://ui.webrtc-thesis.ru")
driver.implicitly_wait(5)
time.sleep(10000)
