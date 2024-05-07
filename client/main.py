import time
import sys
from selenium.webdriver import Chrome, ChromeOptions, ChromeService
from selenium.webdriver.common.by import By


path = sys.argv[1]
headless = int(sys.argv[2])

options = ChromeOptions()
options.add_argument("use-fake-device-for-media-stream")
options.add_argument("use-fake-ui-for-media-stream")
options.add_argument("ignore-certificate-errors")
options.add_argument("no-sandbox")
options.add_argument("disable-dev-shm-usage")
if headless:
    options.add_argument("--headless=new")

service = ChromeService(executable_path='/Users/ilyasiluyanov/Downloads/yandexdriver')
driver = Chrome(options=options, service=service)
try:
    driver.get("https://ui.webrtc-thesis.ru")
    driver.implicitly_wait(5)
    while True:
        time.sleep(5)
        elements = driver.find_elements(By.CLASS_NAME, "candidatetext")
        for element in elements:
            id_ = element.get_dom_attribute("id")
            text = element.text
            print(f"{id_}: {text}")
finally:
    print("close driver")
    driver.close()
