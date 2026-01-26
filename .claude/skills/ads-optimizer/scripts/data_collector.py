"""
Data Collector Module for Ads Optimizer v2

Парсит локальные файлы конфигурации:
1. Briefs — целевые CPL и настройки по направлениям
2. Creatives.md — реестр тегов креативов
3. History — история действий за последние 3 дня

НЕ делает HTTP запросы. Данные из Facebook API собираются
через MCP tools в SKILL.md и передаются сюда как JSON.
"""

import os
import re
import json
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field


@dataclass
class DirectionConfig:
    """Конфигурация направления из брифа"""
    name: str
    campaign_id: str
    target_cpl: float
    daily_budget: float
    geo: str = ""
    age_min: int = 25
    age_max: int = 65


@dataclass
class CreativeTagInfo:
    """Информация о теге креатива из creatives.md"""
    tag: str
    direction: str
    description: str
    status: str  # active, paused, testing


@dataclass
class HistoryEntry:
    """Запись из истории действий"""
    date: str
    adset_id: str
    adset_name: str
    action: str  # increased, decreased, paused, created
    old_budget: Optional[float]
    new_budget: Optional[float]
    reason: str


@dataclass
class AdsetData:
    """Собранные данные по adset"""
    adset_id: str
    adset_name: str
    campaign_id: str
    direction: str
    status: str
    daily_budget: float
    created_time: Optional[datetime]

    # Метрики за периоды
    spend_today: float = 0
    leads_today: int = 0
    impressions_today: int = 0
    ctr_today: Optional[float] = None
    cpm_today: Optional[float] = None
    frequency_today: Optional[float] = None

    spend_yesterday: float = 0
    leads_yesterday: int = 0

    spend_3d: float = 0
    leads_3d: int = 0

    spend_7d: float = 0
    leads_7d: int = 0

    spend_14d: float = 0
    leads_14d: int = 0

    # Вычисленные CPL
    cpl_today: Optional[float] = None
    cpl_yesterday: Optional[float] = None
    cpl_3d: Optional[float] = None
    cpl_7d: Optional[float] = None

    # История
    is_new: bool = False
    was_decreased_yesterday: bool = False
    was_increased_yesterday: bool = False
    consecutive_decreases: int = 0


@dataclass
class AdData:
    """Собранные данные по объявлению"""
    ad_id: str
    ad_name: str
    adset_id: str
    adset_name: str
    direction: str
    creative_tag: str
    status: str

    spend: float = 0
    leads: int = 0
    spend_3d: float = 0
    leads_3d: int = 0
    spend_7d: float = 0
    leads_7d: int = 0


@dataclass
class CollectedData:
    """Все собранные данные"""
    account_id: str
    account_name: str
    collection_time: str

    directions: List[DirectionConfig] = field(default_factory=list)
    creative_tags: List[CreativeTagInfo] = field(default_factory=list)
    history: List[HistoryEntry] = field(default_factory=list)
    adsets: List[AdsetData] = field(default_factory=list)
    ads: List[AdData] = field(default_factory=list)

    # Summary
    total_spend_yesterday: float = 0
    total_leads_yesterday: int = 0


# === Brief Parser ===

def parse_brief(brief_path: str) -> List[DirectionConfig]:
    """
    Парсит бриф аккаунта.

    Ожидаемый формат в briefs/{name}.md:
    ## Направления
    | Направление | Campaign ID | Target CPL | Daily Budget |
    |-------------|-------------|------------|--------------|
    | Имплантация | 120213249329150185 | $4.00 | $100 |
    """
    directions = []

    if not os.path.exists(brief_path):
        return directions

    with open(brief_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Find table with directions
    # Match markdown table rows
    table_pattern = r'\|\s*([^|]+)\s*\|\s*(\d+)\s*\|\s*\$?([\d.]+)\s*\|\s*\$?([\d.]+)\s*\|'

    for match in re.finditer(table_pattern, content):
        name = match.group(1).strip()
        campaign_id = match.group(2).strip()
        target_cpl = float(match.group(3))
        daily_budget = float(match.group(4))

        # Skip header rows
        if name.lower() in ['направление', 'direction', '---', '-']:
            continue

        directions.append(DirectionConfig(
            name=name,
            campaign_id=campaign_id,
            target_cpl=target_cpl,
            daily_budget=daily_budget
        ))

    return directions


# === Creatives.md Parser ===

def parse_creatives_md(creatives_path: str) -> List[CreativeTagInfo]:
    """
    Парсит реестр креативов.

    Ожидаемый формат в config/creatives.md:
    ## Направление: Имплантация
    | Tag | Description | Status |
    |-----|-------------|--------|
    | kitchen | Кухня с имплантами | active |
    """
    tags = []

    if not os.path.exists(creatives_path):
        return tags

    with open(creatives_path, 'r', encoding='utf-8') as f:
        content = f.read()

    current_direction = "Unknown"

    # Find direction headers and tables
    direction_pattern = r'##\s*(?:Направление[:\s]*)?(.+)'
    table_pattern = r'\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*(active|paused|testing)\s*\|'

    lines = content.split('\n')
    for line in lines:
        # Check for direction header
        dir_match = re.match(direction_pattern, line)
        if dir_match:
            current_direction = dir_match.group(1).strip()
            continue

        # Check for table row
        table_match = re.match(table_pattern, line, re.IGNORECASE)
        if table_match:
            tag = table_match.group(1).strip()
            description = table_match.group(2).strip()
            status = table_match.group(3).strip().lower()

            # Skip headers
            if tag.lower() in ['tag', '---', '-']:
                continue

            tags.append(CreativeTagInfo(
                tag=tag,
                direction=current_direction,
                description=description,
                status=status
            ))

    return tags


# === History Parser ===

def parse_history(history_dir: str, days: int = 3) -> List[HistoryEntry]:
    """
    Читает историю действий за последние N дней.

    Формат файлов: history/YYYY-MM/YYYY-MM-DD.md
    """
    entries = []

    today = datetime.now()

    for i in range(days):
        date = today - timedelta(days=i)
        date_str = date.strftime('%Y-%m-%d')
        month_dir = date.strftime('%Y-%m')

        file_path = os.path.join(history_dir, month_dir, f"{date_str}.md")

        if not os.path.exists(file_path):
            continue

        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # Parse action entries
        # Expected format:
        # ### Adset: Name (ID)
        # - Action: increased/decreased/paused
        # - Budget: $X → $Y
        # - Reason: ...

        current_adset_id = None
        current_adset_name = None

        for line in content.split('\n'):
            # Adset header
            adset_match = re.match(r'###\s*(?:Adset[:\s]*)?(.+?)\s*\((\d+)\)', line)
            if adset_match:
                current_adset_name = adset_match.group(1).strip()
                current_adset_id = adset_match.group(2).strip()
                continue

            # Action line
            action_match = re.match(r'-\s*Action:\s*(increased|decreased|paused|created)', line, re.IGNORECASE)
            if action_match and current_adset_id:
                action = action_match.group(1).lower()

                # Try to find budget change
                old_budget = None
                new_budget = None
                reason = ""

                # Look for budget in next lines
                budget_match = re.search(r'\$?([\d.]+)\s*[→->]+\s*\$?([\d.]+)', content[content.find(line):])
                if budget_match:
                    old_budget = float(budget_match.group(1))
                    new_budget = float(budget_match.group(2))

                entries.append(HistoryEntry(
                    date=date_str,
                    adset_id=current_adset_id,
                    adset_name=current_adset_name or "",
                    action=action,
                    old_budget=old_budget,
                    new_budget=new_budget,
                    reason=reason
                ))

    return entries


# === Helper Functions ===

def extract_leads_from_actions(actions: List[Dict]) -> int:
    """Извлекает количество leads из actions."""
    if not actions:
        return 0

    for action in actions:
        action_type = action.get('action_type', '')
        if action_type in ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead']:
            return int(action.get('value', 0))

    return 0


def extract_creative_tag(ad_name: str) -> str:
    """
    Извлекает creative_tag из имени объявления.

    Конвенция: AdSet_Name - creative_tag или просто creative_tag
    """
    # Try to extract after dash
    if ' - ' in ad_name:
        parts = ad_name.split(' - ')
        return parts[-1].strip().lower()

    # Try to extract from brackets
    bracket_match = re.search(r'\[([^\]]+)\]', ad_name)
    if bracket_match:
        return bracket_match.group(1).strip().lower()

    # Return cleaned name
    return re.sub(r'[^a-zA-Z0-9_]', '_', ad_name.lower())[:30]


def calculate_cpls(data: AdsetData) -> None:
    """Вычисляет CPL для всех периодов."""
    if data.leads_today > 0:
        data.cpl_today = round(data.spend_today / data.leads_today, 2)

    if data.leads_yesterday > 0:
        data.cpl_yesterday = round(data.spend_yesterday / data.leads_yesterday, 2)

    if data.leads_3d > 0:
        data.cpl_3d = round(data.spend_3d / data.leads_3d, 2)

    if data.leads_7d > 0:
        data.cpl_7d = round(data.spend_7d / data.leads_7d, 2)


def apply_history_flags(
    adset: AdsetData,
    history: List[HistoryEntry],
    today: datetime
) -> None:
    """Применяет флаги истории к adset."""
    # Check if new (< 48h)
    if adset.created_time:
        age = today - adset.created_time
        adset.is_new = age.total_seconds() < 48 * 3600

    # Analyze history entries for this adset
    yesterday = (today - timedelta(days=1)).strftime('%Y-%m-%d')
    consecutive_decreases = 0
    last_decrease_date = None

    for entry in history:
        if entry.adset_id != adset.adset_id:
            continue

        if entry.action == 'decreased':
            if entry.date == yesterday:
                adset.was_decreased_yesterday = True

            # Count consecutive decreases
            if last_decrease_date is None:
                last_decrease_date = entry.date
                consecutive_decreases = 1
            else:
                # Check if consecutive day
                entry_date = datetime.strptime(entry.date, '%Y-%m-%d')
                last_date = datetime.strptime(last_decrease_date, '%Y-%m-%d')
                if (last_date - entry_date).days == 1:
                    consecutive_decreases += 1
                    last_decrease_date = entry.date

        elif entry.action == 'increased':
            if entry.date == yesterday:
                adset.was_increased_yesterday = True
            # Reset consecutive decreases
            consecutive_decreases = 0
            last_decrease_date = None

    adset.consecutive_decreases = consecutive_decreases


def parse_mcp_insights(insights_json: List[Dict], period: str, adset: AdsetData) -> None:
    """
    Парсит insights из MCP API response и заполняет AdsetData.

    Вызывается из optimizer.py после получения данных через MCP.
    """
    for insight in insights_json:
        if insight.get('adset_id') != adset.adset_id:
            continue

        spend = float(insight.get('spend', 0))
        leads = extract_leads_from_actions(insight.get('actions', []))
        impressions = int(insight.get('impressions', 0))

        if period == 'today':
            adset.spend_today = spend
            adset.leads_today = leads
            adset.impressions_today = impressions
            adset.ctr_today = float(insight.get('ctr', 0))
            adset.cpm_today = float(insight.get('cpm', 0))
            adset.frequency_today = float(insight.get('frequency', 0))
        elif period == 'yesterday':
            adset.spend_yesterday = spend
            adset.leads_yesterday = leads
        elif period == 'last_3d':
            adset.spend_3d = spend
            adset.leads_3d = leads
        elif period == 'last_7d':
            adset.spend_7d = spend
            adset.leads_7d = leads
        elif period == 'last_14d':
            adset.spend_14d = spend
            adset.leads_14d = leads


def collect_local_data(
    account_id: str,
    account_name: str,
    brief_path: str,
    creatives_path: str,
    history_dir: str
) -> CollectedData:
    """
    Собирает данные из локальных файлов.

    Данные из Facebook API должны быть добавлены отдельно
    через parse_mcp_insights() после вызова MCP tools.
    """
    now = datetime.now()

    data = CollectedData(
        account_id=account_id,
        account_name=account_name,
        collection_time=now.isoformat()
    )

    # 1. Parse brief
    data.directions = parse_brief(brief_path)

    # 2. Parse creatives
    data.creative_tags = parse_creatives_md(creatives_path)

    # 3. Parse history
    data.history = parse_history(history_dir)

    return data


# === Output Converters ===

def adset_data_to_dict(adset: AdsetData) -> Dict[str, Any]:
    """Конвертирует AdsetData в словарь."""
    return {
        "id": adset.adset_id,
        "name": adset.adset_name,
        "campaign_id": adset.campaign_id,
        "direction": adset.direction,
        "status": adset.status,
        "daily_budget": adset.daily_budget,
        "spend_today": adset.spend_today,
        "leads_today": adset.leads_today,
        "impressions_today": adset.impressions_today,
        "ctr_today": adset.ctr_today,
        "cpm_today": adset.cpm_today,
        "frequency_today": adset.frequency_today,
        "spend_yesterday": adset.spend_yesterday,
        "leads_yesterday": adset.leads_yesterday,
        "cpl_yesterday": adset.cpl_yesterday,
        "cpl_today": adset.cpl_today,
        "cpl_3d": adset.cpl_3d,
        "cpl_7d": adset.cpl_7d,
        "is_new": adset.is_new,
        "was_decreased_yesterday": adset.was_decreased_yesterday,
        "was_increased_yesterday": adset.was_increased_yesterday,
        "consecutive_decreases": adset.consecutive_decreases
    }


def ad_data_to_dict(ad: AdData) -> Dict[str, Any]:
    """Конвертирует AdData в словарь."""
    return {
        "ad_id": ad.ad_id,
        "ad_name": ad.ad_name,
        "adset_id": ad.adset_id,
        "adset_name": ad.adset_name,
        "direction": ad.direction,
        "creative_tag": ad.creative_tag,
        "status": ad.status,
        "spend": ad.spend,
        "leads": ad.leads,
        "spend_3d": ad.spend_3d,
        "leads_3d": ad.leads_3d,
        "spend_7d": ad.spend_7d,
        "leads_7d": ad.leads_7d
    }


def collected_data_to_dict(data: CollectedData) -> Dict[str, Any]:
    """Конвертирует всё в словарь для YAML вывода."""
    return {
        "account": {
            "id": data.account_id,
            "name": data.account_name,
            "collection_time": data.collection_time
        },
        "summary": {
            "total_adsets": len(data.adsets),
            "total_ads": len(data.ads),
            "total_spend_yesterday": round(data.total_spend_yesterday, 2),
            "total_leads_yesterday": data.total_leads_yesterday,
            "avg_cpl_yesterday": round(
                data.total_spend_yesterday / data.total_leads_yesterday, 2
            ) if data.total_leads_yesterday > 0 else None
        },
        "directions": [
            {
                "name": d.name,
                "campaign_id": d.campaign_id,
                "target_cpl": d.target_cpl,
                "daily_budget": d.daily_budget
            }
            for d in data.directions
        ],
        "adsets": [adset_data_to_dict(a) for a in data.adsets],
        "ads": [ad_data_to_dict(a) for a in data.ads]
    }


# === Unit Tests ===

if __name__ == "__main__":
    import json

    print("=== Data Collector Unit Tests ===\n")

    # Test 1: Extract creative tag
    print("Test 1: Extract Creative Tag")
    assert extract_creative_tag("Set 1 - kitchen") == "kitchen"
    assert extract_creative_tag("Promo [bathroom]") == "bathroom"
    assert extract_creative_tag("SimpleAd") == "simplead"
    print("✓ Creative tag extraction passed\n")

    # Test 2: Extract leads from actions
    print("Test 2: Extract Leads from Actions")
    actions = [
        {"action_type": "link_click", "value": "100"},
        {"action_type": "lead", "value": "15"},
        {"action_type": "page_engagement", "value": "50"}
    ]
    leads = extract_leads_from_actions(actions)
    assert leads == 15
    print(f"  Extracted {leads} leads")
    print("✓ Leads extraction passed\n")

    # Test 3: Calculate CPLs
    print("Test 3: Calculate CPLs")
    adset = AdsetData(
        adset_id="123",
        adset_name="Test",
        campaign_id="456",
        direction="Test",
        status="ACTIVE",
        daily_budget=50,
        created_time=None,
        spend_yesterday=100,
        leads_yesterday=25,
        spend_3d=250,
        leads_3d=60
    )
    calculate_cpls(adset)
    assert adset.cpl_yesterday == 4.0
    assert abs(adset.cpl_3d - 4.17) < 0.1
    print(f"  CPL yesterday: ${adset.cpl_yesterday}")
    print(f"  CPL 3d: ${adset.cpl_3d}")
    print("✓ CPL calculation passed\n")

    # Test 4: History flags
    print("Test 4: History Flags")
    history = [
        HistoryEntry(
            date=(datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d'),
            adset_id="123",
            adset_name="Test",
            action="decreased",
            old_budget=60,
            new_budget=50,
            reason="High CPL"
        )
    ]
    apply_history_flags(adset, history, datetime.now())
    assert adset.was_decreased_yesterday == True
    print(f"  was_decreased_yesterday: {adset.was_decreased_yesterday}")
    print("✓ History flags passed\n")

    # Test 5: Output format
    print("Test 5: Output Format")
    data = CollectedData(
        account_id="act_123",
        account_name="Test Account",
        collection_time=datetime.now().isoformat()
    )
    data.adsets = [adset]
    output = collected_data_to_dict(data)
    print(json.dumps(output, indent=2, default=str)[:500])
    assert "account" in output
    assert "summary" in output
    assert "adsets" in output
    print("\n✓ Output format passed\n")

    print("=== All tests passed! ===")
