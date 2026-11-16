# 저작권 및 데이터 출처 고지 (NOTICE)

이 저장소는 성경을 읽고 검색하는 정적 웹앱이며, 아래 주소에서 공개 운영 중입니다.

- 사이트: **https://krgpt.github.io/bible/**
- 저장소: https://github.com/krgpt/bible

## 성경 본문 데이터 (`data/*.js`, `build/patches.txt`)

| 역본 | 저작권 |
| --- | --- |
| 개역개정 (KOR) | © 대한성서공회 (Korean Bible Society). 대한성서공회의 허락을 받아 게시합니다. |
| NIV (New International Version) | © Biblica, Inc.™ All rights reserved worldwide. |
| KJV (King James Version) | Public Domain |

- 개역개정 본문은 **대한성서공회의 정식 허락**을 받아 공개 게시 중입니다.
- NIV 본문은 Biblica의 저작물입니다. 공개 게시·재배포 범위는 Biblica의 이용 허락 조건을 따릅니다.
- 본문 데이터를 복제·재배포하거나 상업적으로 이용하려는 경우, 해당 역본 저작권자의 별도 허락이 필요합니다.

## 코드 (`index.html`, `assets/*`, `build/*.py`)

코드 부분의 라이선스는 **미정**입니다(현재 모든 권리 유보, All rights reserved).
필요 시 별도 LICENSE 파일로 명시할 수 있습니다.

## 구조 참고 자료

책/장/절 구조(66권, 1,189장, 31,102절)는 `mdbible-main` 자료를 구조 확인용으로만 참고했으며, 본 저장소에는 포함하지 않았습니다.

## 원문 데이터 제공 안내

`build/build_data.py`는 상위 폴더의 원본 텍스트(`ENG-KJV-text`, `ENG-NIV-test`, `KOR-개역개정-text`)를 읽어 `data/*.js`를 생성합니다. 원본 텍스트 폴더는 이 저장소에 포함되어 있지 않으므로, 데이터를 재생성하려면 해당 원본이 별도로 필요합니다.
