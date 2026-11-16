# 저작권 및 데이터 출처 고지 (NOTICE)

이 저장소는 **개인 열람·검색 용도**의 정적 성경 웹앱입니다. 비공개(private) 저장소로 운영을 전제로 하며, 성경 본문 데이터는 아래 출판사의 저작물입니다.

## 성경 본문 데이터 (`data/*.js`, `build/patches.txt`)

| 역본 | 저작권 |
| --- | --- |
| 개역개정 (KOR) | © 대한성서공회 (Korean Bible Society). All rights reserved. |
| NIV (New International Version) | © Biblica, Inc.™ All rights reserved worldwide. |
| KJV (King James Version) | Public Domain (영국/미국 기준 저작권 만료) |

- 개역개정과 NIV 본문은 **개인적인 열람·연구 목적**으로만 사용합니다.
- 본 저장소의 본문 데이터를 **복제·재배포·공개 게시(웹사이트 공개 포함)·상업적 이용**하는 것은 저작권자의 허가 없이는 허용되지 않습니다.
- 저장소를 공개(public)로 전환하거나 GitHub Pages 등으로 본문을 게시하려면, 반드시 해당 저작권자의 이용 허락을 먼저 받아야 합니다.

## 코드 (`index.html`, `assets/*`, `build/*.py`)

코드 부분의 라이선스는 **미정**입니다(현재 모든 권리 유보, All rights reserved).
필요 시 별도 LICENSE 파일로 명시할 수 있습니다.

## 구조 참고 자료

책/장/절 구조(66권, 1,189장, 31,102절)는 `mdbible-main` 자료를 구조 확인용으로만 참고했으며, 본 저장소에는 포함하지 않았습니다.

## 원문 데이터 제공 안내

`build/build_data.py`는 상위 폴더의 원본 텍스트(`ENG-KJV-text`, `ENG-NIV-test`, `KOR-개역개정-text`)를 읽어 `data/*.js`를 생성합니다. 원본 텍스트 폴더는 이 저장소에 포함되어 있지 않으므로, 데이터를 재생성하려면 해당 원본이 별도로 필요합니다.
