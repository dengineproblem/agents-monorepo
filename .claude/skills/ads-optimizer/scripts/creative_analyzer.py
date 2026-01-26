"""
Creative Analyzer Module for Ads Optimizer v2

Анализирует креативы (creative_tag) и находит проблемные объявления.

Функции:
1. Risk Score (0-100) — оценка риска креатива
2. Ad-Eaters Detection — поиск объявлений, съедающих бюджет без результата
3. Fatigue Detection — выявление усталости аудитории
4. Unused Creatives — неиспользуемые креативы

Risk Score формула:
- Base CPL deviation (0-40)
- Trend component (0-20)
- Volume confidence (0-20)
- Consistency bonus (-20 to 0)

Risk Levels:
- Low: 0-25 → рекомендация scale
- Medium: 26-50 → рекомендация monitor
- High: 51-75 → рекомендация reduce
- Critical: 76-100 → рекомендация pause

Ad-Eaters Priority:
- CRITICAL: CPL > 3× target (немедленная пауза)
- HIGH: 0 leads + spend ≥ 2× avg (высокий приоритет)
- MEDIUM: CPL > 1.5× target + >50% spend share (средний)
"""

from dataclasses import dataclass
from typing import Optional, List, Dict, Any, Tuple
from enum import Enum
import statistics


class RiskLevel(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class AdEaterPriority(Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"


@dataclass
class CreativeTag:
    """Агрегированные данные по creative_tag"""
    tag: str
    ads_count: int
    total_spend: float
    total_leads: int
    agg_cpl: Optional[float]
    risk_score: int
    risk_level: RiskLevel
    trend: str  # "improving", "stable", "declining"
    recommendation: str  # "scale", "monitor", "reduce", "pause"

    # Детали для отладки
    spend_3d: float
    spend_7d: float
    leads_3d: int
    leads_7d: int
    cpl_3d: Optional[float]
    cpl_7d: Optional[float]


@dataclass
class AdEater:
    """Объявление, съедающее бюджет"""
    ad_id: str
    ad_name: str
    adset_id: str
    adset_name: str
    direction: str
    spend: float
    leads: int
    cpl: Optional[float]
    priority: AdEaterPriority
    spend_share_pct: float
    will_adset_be_empty: bool
    reason: str


@dataclass
class FatigueAlert:
    """Предупреждение об усталости креатива"""
    tag: str
    frequency: float
    ctr_current: float
    ctr_baseline: float
    ctr_decline_pct: float
    recommendation: str


@dataclass
class UnusedCreative:
    """Неиспользуемый креатив"""
    direction: str
    tag: str
    status: str  # "active", "inactive"
    last_used_days_ago: Optional[int]


# === Risk Score Calculation ===

def calculate_risk_score(
    agg_cpl: Optional[float],
    target_cpl: float,
    cpl_3d: Optional[float],
    cpl_7d: Optional[float],
    total_spend: float,
    min_spend_for_confidence: float = 50.0
) -> Tuple[int, RiskLevel]:
    """
    Вычисляет Risk Score (0-100) для creative_tag.

    Components:
    1. Base CPL deviation (0-40): насколько CPL отличается от таргета
    2. Trend component (0-20): ухудшается ли CPL
    3. Volume confidence (0-20): достаточно ли данных
    4. Consistency bonus (-20 to 0): стабильность результатов

    Returns:
        Tuple[risk_score, risk_level]
    """
    score = 0

    # 1. Base CPL deviation (0-40)
    if agg_cpl is not None and agg_cpl > 0:
        ratio = agg_cpl / target_cpl
        if ratio <= 1.0:
            # CPL <= target: low risk
            cpl_component = 0
        elif ratio <= 1.5:
            # 1.0-1.5: linear 0-20
            cpl_component = (ratio - 1.0) * 40
        elif ratio <= 2.0:
            # 1.5-2.0: linear 20-35
            cpl_component = 20 + (ratio - 1.5) * 30
        else:
            # >2.0: high risk
            cpl_component = min(40, 35 + (ratio - 2.0) * 10)
        score += cpl_component
    else:
        # No leads yet — moderate risk
        score += 25

    # 2. Trend component (0-20)
    if cpl_3d is not None and cpl_7d is not None and cpl_7d > 0:
        trend_pct = (cpl_3d - cpl_7d) / cpl_7d * 100
        if trend_pct <= -10:
            # Improving: reduce risk
            trend_component = 0
        elif trend_pct <= 0:
            trend_component = 5
        elif trend_pct <= 20:
            trend_component = 5 + trend_pct * 0.5
        else:
            trend_component = 15 + min(5, (trend_pct - 20) * 0.25)
        score += trend_component
    else:
        # No trend data
        score += 10

    # 3. Volume confidence (0-20)
    if total_spend >= min_spend_for_confidence * 2:
        volume_component = 0  # High confidence
    elif total_spend >= min_spend_for_confidence:
        volume_component = 10  # Medium confidence
    elif total_spend >= min_spend_for_confidence * 0.5:
        volume_component = 15  # Low confidence
    else:
        volume_component = 20  # Very low confidence
    score += volume_component

    # 4. Consistency bonus (-20 to 0)
    # If 3d and 7d CPL are close, creative is consistent
    if cpl_3d is not None and cpl_7d is not None and cpl_7d > 0:
        variance_pct = abs(cpl_3d - cpl_7d) / cpl_7d * 100
        if variance_pct <= 10:
            consistency_bonus = -20
        elif variance_pct <= 20:
            consistency_bonus = -10
        elif variance_pct <= 30:
            consistency_bonus = -5
        else:
            consistency_bonus = 0
        score += consistency_bonus

    # Clamp to 0-100
    score = max(0, min(100, round(score)))

    # Determine level
    if score <= 25:
        level = RiskLevel.LOW
    elif score <= 50:
        level = RiskLevel.MEDIUM
    elif score <= 75:
        level = RiskLevel.HIGH
    else:
        level = RiskLevel.CRITICAL

    return score, level


def determine_trend(cpl_3d: Optional[float], cpl_7d: Optional[float]) -> str:
    """Определяет тренд CPL."""
    if cpl_3d is None or cpl_7d is None or cpl_7d == 0:
        return "stable"

    change_pct = (cpl_3d - cpl_7d) / cpl_7d * 100

    if change_pct <= -10:
        return "improving"
    elif change_pct >= 10:
        return "declining"
    else:
        return "stable"


def determine_recommendation(risk_level: RiskLevel, trend: str) -> str:
    """Определяет рекомендацию на основе Risk Level и тренда."""
    if risk_level == RiskLevel.LOW:
        return "scale" if trend != "declining" else "monitor"
    elif risk_level == RiskLevel.MEDIUM:
        return "monitor"
    elif risk_level == RiskLevel.HIGH:
        return "reduce"
    else:
        return "pause"


# === Ad-Eaters Detection ===

def detect_ad_eaters(
    ads_data: List[Dict[str, Any]],
    target_cpl: float,
    avg_spend_per_ad: float
) -> List[AdEater]:
    """
    Находит объявления, съедающие бюджет без результата.

    Критерии:
    - CRITICAL: CPL > 3× target
    - HIGH: 0 leads + spend ≥ 2× avg
    - MEDIUM: CPL > 1.5× target + >50% spend share in adset

    Args:
        ads_data: List of ad dictionaries with spend, leads, adset info
        target_cpl: Target CPL for the direction
        avg_spend_per_ad: Average spend per ad in the account

    Returns:
        List of AdEater objects sorted by priority
    """
    eaters = []

    # Group ads by adset for spend share calculation
    adset_spends: Dict[str, float] = {}
    adset_ads: Dict[str, List[Dict]] = {}

    for ad in ads_data:
        adset_id = ad.get('adset_id', '')
        spend = ad.get('spend', 0) or 0

        if adset_id not in adset_spends:
            adset_spends[adset_id] = 0
            adset_ads[adset_id] = []

        adset_spends[adset_id] += spend
        adset_ads[adset_id].append(ad)

    for ad in ads_data:
        spend = ad.get('spend', 0) or 0
        leads = ad.get('leads', 0) or 0
        adset_id = ad.get('adset_id', '')
        adset_spend = adset_spends.get(adset_id, 1)

        # Calculate CPL
        cpl = spend / leads if leads > 0 else None

        # Calculate spend share in adset
        spend_share_pct = (spend / adset_spend * 100) if adset_spend > 0 else 0

        # Check if this is the only ad in adset
        ads_in_adset = len(adset_ads.get(adset_id, []))
        will_adset_be_empty = ads_in_adset <= 1

        priority = None
        reason = ""

        # CRITICAL: CPL > 3× target
        if cpl is not None and cpl > target_cpl * 3:
            priority = AdEaterPriority.CRITICAL
            reason = f"CPL ${cpl:.2f} > 3× target ${target_cpl:.2f}"

        # HIGH: 0 leads + spend ≥ 2× avg
        elif leads == 0 and spend >= avg_spend_per_ad * 2:
            priority = AdEaterPriority.HIGH
            reason = f"0 leads, spend ${spend:.2f} ≥ 2× avg ${avg_spend_per_ad:.2f}"

        # MEDIUM: CPL > 1.5× target + >50% spend share
        elif cpl is not None and cpl > target_cpl * 1.5 and spend_share_pct > 50:
            priority = AdEaterPriority.MEDIUM
            reason = f"CPL ${cpl:.2f} > 1.5× target, {spend_share_pct:.0f}% of adset budget"

        if priority:
            eaters.append(AdEater(
                ad_id=ad.get('ad_id', ''),
                ad_name=ad.get('ad_name', ''),
                adset_id=adset_id,
                adset_name=ad.get('adset_name', ''),
                direction=ad.get('direction', ''),
                spend=spend,
                leads=leads,
                cpl=cpl,
                priority=priority,
                spend_share_pct=round(spend_share_pct, 1),
                will_adset_be_empty=will_adset_be_empty,
                reason=reason
            ))

    # Sort by priority (CRITICAL first)
    priority_order = {
        AdEaterPriority.CRITICAL: 0,
        AdEaterPriority.HIGH: 1,
        AdEaterPriority.MEDIUM: 2
    }
    eaters.sort(key=lambda x: priority_order[x.priority])

    return eaters


# === Fatigue Detection ===

def detect_fatigue(
    creative_tags: List[Dict[str, Any]],
    frequency_threshold: float = 3.0,
    ctr_decline_threshold: float = -20.0
) -> List[FatigueAlert]:
    """
    Выявляет усталость аудитории от креативов.

    Критерии:
    - Frequency > threshold (default 3.0)
    - CTR decline > threshold (default -20%)

    Returns:
        List of FatigueAlert objects
    """
    alerts = []

    for tag_data in creative_tags:
        frequency = tag_data.get('frequency', 0) or 0
        ctr_current = tag_data.get('ctr_current', 0) or 0
        ctr_baseline = tag_data.get('ctr_baseline', ctr_current) or ctr_current

        if ctr_baseline > 0:
            ctr_decline_pct = (ctr_current - ctr_baseline) / ctr_baseline * 100
        else:
            ctr_decline_pct = 0

        # Check fatigue conditions
        is_fatigued = (
            frequency > frequency_threshold or
            ctr_decline_pct < ctr_decline_threshold
        )

        if is_fatigued:
            recommendation = "replace"
            if frequency > frequency_threshold * 1.5:
                recommendation = "urgent_replace"
            elif ctr_decline_pct < ctr_decline_threshold * 1.5:
                recommendation = "urgent_replace"

            alerts.append(FatigueAlert(
                tag=tag_data.get('tag', ''),
                frequency=frequency,
                ctr_current=ctr_current,
                ctr_baseline=ctr_baseline,
                ctr_decline_pct=round(ctr_decline_pct, 1),
                recommendation=recommendation
            ))

    return alerts


# === Creative Tag Aggregation ===

def aggregate_by_creative_tag(
    ads_data: List[Dict[str, Any]],
    target_cpl: float
) -> List[CreativeTag]:
    """
    Группирует объявления по creative_tag и вычисляет метрики.

    Args:
        ads_data: List of ad dictionaries with creative_tag, spend, leads, etc.
        target_cpl: Target CPL for the direction

    Returns:
        List of CreativeTag objects
    """
    # Group by tag
    tags: Dict[str, Dict[str, Any]] = {}

    for ad in ads_data:
        tag = ad.get('creative_tag', 'unknown')

        if tag not in tags:
            tags[tag] = {
                'ads_count': 0,
                'total_spend': 0,
                'total_leads': 0,
                'spend_3d': 0,
                'spend_7d': 0,
                'leads_3d': 0,
                'leads_7d': 0
            }

        tags[tag]['ads_count'] += 1
        tags[tag]['total_spend'] += ad.get('spend', 0) or 0
        tags[tag]['total_leads'] += ad.get('leads', 0) or 0
        tags[tag]['spend_3d'] += ad.get('spend_3d', 0) or 0
        tags[tag]['spend_7d'] += ad.get('spend_7d', 0) or 0
        tags[tag]['leads_3d'] += ad.get('leads_3d', 0) or 0
        tags[tag]['leads_7d'] += ad.get('leads_7d', 0) or 0

    # Calculate metrics for each tag
    result = []

    for tag, data in tags.items():
        total_spend = data['total_spend']
        total_leads = data['total_leads']
        spend_3d = data['spend_3d']
        spend_7d = data['spend_7d']
        leads_3d = data['leads_3d']
        leads_7d = data['leads_7d']

        # Calculate CPLs
        agg_cpl = total_spend / total_leads if total_leads > 0 else None
        cpl_3d = spend_3d / leads_3d if leads_3d > 0 else None
        cpl_7d = spend_7d / leads_7d if leads_7d > 0 else None

        # Calculate Risk Score
        risk_score, risk_level = calculate_risk_score(
            agg_cpl=agg_cpl,
            target_cpl=target_cpl,
            cpl_3d=cpl_3d,
            cpl_7d=cpl_7d,
            total_spend=total_spend
        )

        # Determine trend
        trend = determine_trend(cpl_3d, cpl_7d)

        # Determine recommendation
        recommendation = determine_recommendation(risk_level, trend)

        result.append(CreativeTag(
            tag=tag,
            ads_count=data['ads_count'],
            total_spend=round(total_spend, 2),
            total_leads=total_leads,
            agg_cpl=round(agg_cpl, 2) if agg_cpl else None,
            risk_score=risk_score,
            risk_level=risk_level,
            trend=trend,
            recommendation=recommendation,
            spend_3d=round(spend_3d, 2),
            spend_7d=round(spend_7d, 2),
            leads_3d=leads_3d,
            leads_7d=leads_7d,
            cpl_3d=round(cpl_3d, 2) if cpl_3d else None,
            cpl_7d=round(cpl_7d, 2) if cpl_7d else None
        ))

    # Sort by risk score (lowest first — best creatives)
    result.sort(key=lambda x: x.risk_score)

    return result


# === Output Converters ===

def creative_tag_to_dict(tag: CreativeTag) -> Dict[str, Any]:
    """Конвертирует CreativeTag в словарь для YAML."""
    return {
        "tag": tag.tag,
        "ads_count": tag.ads_count,
        "total_spend": tag.total_spend,
        "total_leads": tag.total_leads,
        "agg_cpl": tag.agg_cpl,
        "risk_score": tag.risk_score,
        "risk_level": tag.risk_level.value,
        "trend": tag.trend,
        "recommendation": tag.recommendation
    }


def ad_eater_to_dict(eater: AdEater) -> Dict[str, Any]:
    """Конвертирует AdEater в словарь для YAML."""
    return {
        "ad_id": eater.ad_id,
        "ad_name": eater.ad_name,
        "adset_id": eater.adset_id,
        "adset_name": eater.adset_name,
        "direction": eater.direction,
        "spend": eater.spend,
        "leads": eater.leads,
        "cpl": eater.cpl,
        "priority": eater.priority.value,
        "spend_share_pct": eater.spend_share_pct,
        "will_adset_be_empty": eater.will_adset_be_empty,
        "reason": eater.reason
    }


def fatigue_alert_to_dict(alert: FatigueAlert) -> Dict[str, Any]:
    """Конвертирует FatigueAlert в словарь для YAML."""
    return {
        "tag": alert.tag,
        "frequency": alert.frequency,
        "ctr_current": alert.ctr_current,
        "ctr_baseline": alert.ctr_baseline,
        "ctr_decline_pct": alert.ctr_decline_pct,
        "recommendation": alert.recommendation
    }


# === Unit Tests ===

if __name__ == "__main__":
    import json

    print("=== Creative Analyzer Unit Tests ===\n")

    # Test 1: Risk Score - Good Creative
    print("Test 1: Risk Score - Good Creative")
    score, level = calculate_risk_score(
        agg_cpl=3.5,
        target_cpl=4.0,
        cpl_3d=3.3,
        cpl_7d=3.8,
        total_spend=150.0
    )
    print(f"  Score: {score}, Level: {level.value}")
    assert score <= 25, f"Expected low risk, got {score}"
    assert level == RiskLevel.LOW
    print("✓ Good creative test passed\n")

    # Test 2: Risk Score - Bad Creative
    print("Test 2: Risk Score - Bad Creative")
    score, level = calculate_risk_score(
        agg_cpl=12.0,
        target_cpl=4.0,
        cpl_3d=14.0,
        cpl_7d=10.0,
        total_spend=80.0
    )
    print(f"  Score: {score}, Level: {level.value}")
    assert score >= 50, f"Expected high risk, got {score}"
    print("✓ Bad creative test passed\n")

    # Test 3: Risk Score - No Data
    print("Test 3: Risk Score - No Data (new creative)")
    score, level = calculate_risk_score(
        agg_cpl=None,
        target_cpl=4.0,
        cpl_3d=None,
        cpl_7d=None,
        total_spend=20.0
    )
    print(f"  Score: {score}, Level: {level.value}")
    assert 40 <= score <= 60, f"Expected medium risk for new creative, got {score}"
    print("✓ No data test passed\n")

    # Test 4: Ad-Eaters Detection
    print("Test 4: Ad-Eaters Detection")
    ads = [
        {"ad_id": "1", "ad_name": "good_ad", "adset_id": "a1", "adset_name": "Set 1",
         "direction": "Test", "spend": 50, "leads": 15},  # CPL=3.33, good
        {"ad_id": "2", "ad_name": "critical_ad", "adset_id": "a1", "adset_name": "Set 1",
         "direction": "Test", "spend": 100, "leads": 5},  # CPL=20 > 3×4=12, CRITICAL
        {"ad_id": "3", "ad_name": "zero_leads_ad", "adset_id": "a2", "adset_name": "Set 2",
         "direction": "Test", "spend": 60, "leads": 0},  # 0 leads, spend > 2×avg, HIGH
    ]
    eaters = detect_ad_eaters(ads, target_cpl=4.0, avg_spend_per_ad=25.0)
    print(f"  Found {len(eaters)} ad-eaters")
    for e in eaters:
        print(f"    - {e.ad_name}: {e.priority.value} ({e.reason})")
    assert len(eaters) == 2
    assert eaters[0].priority == AdEaterPriority.CRITICAL
    assert eaters[1].priority == AdEaterPriority.HIGH
    print("✓ Ad-eaters test passed\n")

    # Test 5: Aggregate by Creative Tag
    print("Test 5: Aggregate by Creative Tag")
    ads_with_tags = [
        {"creative_tag": "kitchen", "spend": 100, "leads": 30, "spend_3d": 50, "leads_3d": 15, "spend_7d": 100, "leads_7d": 30},
        {"creative_tag": "kitchen", "spend": 80, "leads": 20, "spend_3d": 40, "leads_3d": 10, "spend_7d": 80, "leads_7d": 20},
        {"creative_tag": "bathroom", "spend": 60, "leads": 5, "spend_3d": 30, "leads_3d": 2, "spend_7d": 60, "leads_7d": 5},
    ]
    tags = aggregate_by_creative_tag(ads_with_tags, target_cpl=4.0)
    print(f"  Found {len(tags)} creative tags")
    for t in tags:
        print(f"    - {t.tag}: CPL=${t.agg_cpl}, Risk={t.risk_score} ({t.risk_level.value}), Rec={t.recommendation}")
    assert len(tags) == 2
    assert tags[0].tag == "kitchen"  # Better CPL, should be first
    print("✓ Aggregate test passed\n")

    # Test 6: Fatigue Detection
    print("Test 6: Fatigue Detection")
    fatigue_data = [
        {"tag": "old_video", "frequency": 4.5, "ctr_current": 0.8, "ctr_baseline": 1.2},
        {"tag": "fresh_image", "frequency": 1.5, "ctr_current": 1.5, "ctr_baseline": 1.4},
    ]
    alerts = detect_fatigue(fatigue_data)
    print(f"  Found {len(alerts)} fatigue alerts")
    for a in alerts:
        print(f"    - {a.tag}: freq={a.frequency}, CTR decline={a.ctr_decline_pct}%")
    assert len(alerts) == 1
    assert alerts[0].tag == "old_video"
    print("✓ Fatigue test passed\n")

    # Test 7: YAML Output
    print("Test 7: YAML Output")
    tag = tags[0]
    output = creative_tag_to_dict(tag)
    print(json.dumps(output, indent=2))
    assert "tag" in output
    assert "risk_score" in output
    assert "recommendation" in output
    print("✓ YAML output test passed\n")

    print("=== All tests passed! ===")
