from argparse import ArgumentParser
import time
from selenium.webdriver import Chrome, ChromeOptions, ChromeService, Remote
from selenium.webdriver.common.by import By


def main(path: str, headless: bool, remote: bool):

    options = ChromeOptions()
    options.add_argument("use-fake-device-for-media-stream")
    options.add_argument("use-fake-ui-for-media-stream")
    options.add_argument("ignore-certificate-errors")
    options.add_argument("no-sandbox")
    options.add_argument("disable-dev-shm-usage")
    if headless:
        options.add_argument("--headless=new")

    if remote:
        driver = Remote(path, options=options)
    else:
        service = ChromeService(executable_path=path)
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


if __name__ == '__main__':
    parser = ArgumentParser()
    parser.add_argument('--remote', action='store_true')
    parser.add_argument('--headless', action='store_true')
    parser.add_argument('--path', action='store')
    args = parser.parse_args()
    main(args.path, args.headless, args.remote)
