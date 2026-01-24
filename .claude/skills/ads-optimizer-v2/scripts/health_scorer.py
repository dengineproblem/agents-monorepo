"""
Health Scorer Module for Ads Optimizer v2

Вычисляет Health Score (HS) для каждого adset на основе 5 компонентов:
1. CPL Gap (±45) — отклонение CPL от таргета
2. Trends (±15) — сравнение 3d vs 7d
3. Diagnostics (до -30) — CTR, CPM, Frequency
4. Today-compensation (+0..+30) — компенсация за хороший сегодняшний CPL
5. Volume Factor (0.6..1.0) — множитель по объёму impressions

Формула:
HS = round((CPL_Gap + Trends + Diagnostics + Today_Adj) × Volume_Factor)

Классификация:
- very_good: HS ≥ +25
- good: +5 ≤ HS < +25
- neutral: -5 ≤ HS < +5
- slightly_bad: -25 ≤ HS < -5
- bad: HS < -25
"""

from dataclasses import dataclass
from typing import Optional, List, Dict, Any
from enum import Enum
import statistics


class HSClass(Enum):
    VERY_GOOD = "very_good"
    GOOD = "good"
    NEUTRAL = "neutral"
    SLIGHTLY_BAD = "slightly_bad"
    BAD = "bad"


@dataclass
class HSComponents:
    """Компоненты Health Score"""
    cpl_gap: float  # ±45
    trends: float  # ±15
    diagnostics: float  # до -30
    today_adj: float  # +0..+30
    volume_factor: float  # 0.6..1.0


@dataclass
class HistoryFlags:
    """Флаги истории для принятия решений"""
    is_new: bool  # < 48h с момента создания
    was_decreased_yesterday: bool
    was_increased_yesterday: bool
    consecutive_decreases: int


@dataclass
class AdsetHS:
    """Результат расчёта Health Score для adset"""
    adset_id: str
    adset_name: str
    direction: str
    hs: int
    hs_class: HSClass
    components: HSComponents
    history_flags: HistoryFlags

    # Метрики для контекста
    budget: float
    cpl_yesterday: Optional[float]
    cpl_today: Optional[float]
    target_cpl: float
    cpl_diff_pct: Optional[float]
    impressions_today: int


def calculate_cpl_gap(cpl: Optional[float], target_cpl: float) -> float:
    """
    Компонент 1: CPL Gap (±45)

    Формула:
    - CPL ≤ target × 0.5 → +45
    - CPL = target × 0.7 → +30
    - CPL = target → 0
    - CPL = target × 1.5 → -30
    - CPL ≥ target × 2 → -45

    Линейная интерполяция между точками.
    """
    if cpl is None or cpl == 0:
        return 0  # Нет данных — нейтрально

    ratio = cpl / target_cpl

    # Граничные случаи
    if ratio <= 0.5:
        return 45
    if ratio >= 2.0:
        return -45

    # Интерполяция по сегментам
    if ratio <= 0.7:
        # 0.5 → +45, 0.7 → +30
        return 45 - (ratio - 0.5) * (15 / 0.2)
    elif ratio <= 1.0:
        # 0.7 → +30, 1.0 → 0
        return 30 - (ratio - 0.7) * (30 / 0.3)
    elif ratio <= 1.5:
        # 1.0 → 0, 1.5 → -30
        return 0 - (ratio - 1.0) * (30 / 0.5)
    else:
        # 1.5 → -30, 2.0 → -45
        return -30 - (ratio - 1.5) * (15 / 0.5)


def calculate_trends(cpl_3d: Optional[float], cpl_7d: Optional[float]) -> float:
    """
    Компонент 2: Trends (±15)

    Сравниваем CPL за 3 дня vs 7 дней.
    Если CPL_3d < CPL_7d — тренд улучшается → положительный балл.
    Если CPL_3d > CPL_7d — тренд ухудшается → отрицательный балл.

    Формула:
    trend_pct = (CPL_3d - CPL_7d) / CPL_7d × 100

    - trend ≤ -20% → +15 (сильное улучшение)
    - trend = -10% → +7.5
    - trend = 0% → 0
    - trend = +10% → -7.5
    - trend ≥ +20% → -15 (сильное ухудшение)
    """
    if cpl_3d is None or cpl_7d is None or cpl_7d == 0:
        return 0  # Нет данных — нейтрально

    trend_pct = (cpl_3d - cpl_7d) / cpl_7d * 100

    # Ограничиваем диапазоном ±20%
    trend_pct = max(-20, min(20, trend_pct))

    # Линейная интерполяция: -20% → +15, +20% → -15
    return -trend_pct * (15 / 20)


def calculate_diagnostics(
    ctr: Optional[float],
    cpm: Optional[float],
    frequency: Optional[float],
    median_cpm: Optional[float] = None
) -> float:
    """
    Компонент 3: Diagnostics (до -30)

    Штрафы за плохие показатели:
    - CTR < 1% → -8
    - CPM > median × 1.3 → -12
    - Frequency > 2 → -10

    Все штрафы суммируются.
    """
    penalty = 0

    # CTR check
    if ctr is not None and ctr < 1.0:
        penalty -= 8

    # CPM check (если есть медиана для сравнения)
    if cpm is not None and median_cpm is not None and median_cpm > 0:
        if cpm > median_cpm * 1.3:
            penalty -= 12

    # Frequency check
    if frequency is not None and frequency > 2.0:
        penalty -= 10

    return penalty


def calculate_today_adjustment(
    cpl_today: Optional[float],
    cpl_yesterday: Optional[float],
    impressions_today: int,
    min_impressions: int = 500
) -> float:
    """
    Компонент 4: Today-compensation (+0..+30)

    Если сегодняшний CPL лучше вчерашнего, даём бонус.
    Требуется минимум 500 impressions для учёта.

    Формула:
    improvement = (CPL_yesterday - CPL_today) / CPL_yesterday × 100

    - improvement ≥ 30% → +30
    - improvement = 15% → +15
    - improvement ≤ 0% → 0
    """
    if impressions_today < min_impressions:
        return 0  # Недостаточно данных

    if cpl_today is None or cpl_yesterday is None or cpl_yesterday == 0:
        return 0

    # Если сегодня нет лидов (cpl_today = inf или None), нет бонуса
    if cpl_today <= 0:
        return 0

    improvement = (cpl_yesterday - cpl_today) / cpl_yesterday * 100

    if improvement <= 0:
        return 0

    # Линейная интерполяция: 0% → 0, 30% → +30
    return min(30, improvement)


def calculate_volume_factor(impressions: int) -> float:
    """
    Компонент 5: Volume Factor (0.6..1.0)

    Множитель по объёму impressions.
    Маленькие объёмы получают пониженный множитель.

    Формула:
    - impressions < 500 → 0.6
    - impressions 500-1000 → 0.7
    - impressions 1000-2000 → 0.8
    - impressions 2000-5000 → 0.9
    - impressions ≥ 5000 → 1.0
    """
    if impressions < 500:
        return 0.6
    elif impressions < 1000:
        return 0.7
    elif impressions < 2000:
        return 0.8
    elif impressions < 5000:
        return 0.9
    else:
        return 1.0


def classify_hs(hs: int) -> HSClass:
    """
    Классификация Health Score.

    - very_good: HS ≥ +25
    - good: +5 ≤ HS < +25
    - neutral: -5 ≤ HS < +5
    - slightly_bad: -25 ≤ HS < -5
    - bad: HS < -25
    """
    if hs >= 25:
        return HSClass.VERY_GOOD
    elif hs >= 5:
        return HSClass.GOOD
    elif hs >= -5:
        return HSClass.NEUTRAL
    elif hs >= -25:
        return HSClass.SLIGHTLY_BAD
    else:
        return HSClass.BAD


def calculate_health_score(
    adset_id: str,
    adset_name: str,
    direction: str,
    target_cpl: float,
    budget: float,
    cpl_yesterday: Optional[float],
    cpl_today: Optional[float],
    cpl_3d: Optional[float],
    cpl_7d: Optional[float],
    ctr: Optional[float],
    cpm: Optional[float],
    frequency: Optional[float],
    impressions_today: int,
    median_cpm: Optional[float] = None,
    is_new: bool = False,
    was_decreased_yesterday: bool = False,
    was_increased_yesterday: bool = False,
    consecutive_decreases: int = 0
) -> AdsetHS:
    """
    Вычисляет полный Health Score для adset.

    Returns:
        AdsetHS с результатом расчёта
    """
    # Вычисляем компоненты
    cpl_gap = calculate_cpl_gap(cpl_yesterday, target_cpl)
    trends = calculate_trends(cpl_3d, cpl_7d)
    diagnostics = calculate_diagnostics(ctr, cpm, frequency, median_cpm)
    today_adj = calculate_today_adjustment(cpl_today, cpl_yesterday, impressions_today)
    volume_factor = calculate_volume_factor(impressions_today)

    # Финальный HS
    raw_hs = (cpl_gap + trends + diagnostics + today_adj) * volume_factor
    hs = round(raw_hs)

    # Классификация
    hs_class = classify_hs(hs)

    # CPL diff %
    cpl_diff_pct = None
    if cpl_yesterday is not None and target_cpl > 0:
        cpl_diff_pct = round((cpl_yesterday - target_cpl) / target_cpl * 100, 2)

    return AdsetHS(
        adset_id=adset_id,
        adset_name=adset_name,
        direction=direction,
        hs=hs,
        hs_class=hs_class,
        components=HSComponents(
            cpl_gap=round(cpl_gap, 2),
            trends=round(trends, 2),
            diagnostics=round(diagnostics, 2),
            today_adj=round(today_adj, 2),
            volume_factor=volume_factor
        ),
        history_flags=HistoryFlags(
            is_new=is_new,
            was_decreased_yesterday=was_decreased_yesterday,
            was_increased_yesterday=was_increased_yesterday,
            consecutive_decreases=consecutive_decreases
        ),
        budget=budget,
        cpl_yesterday=cpl_yesterday,
        cpl_today=cpl_today,
        target_cpl=target_cpl,
        cpl_diff_pct=cpl_diff_pct,
        impressions_today=impressions_today
    )


def calculate_median_cpm(adsets_data: List[Dict[str, Any]]) -> Optional[float]:
    """
    Вычисляет медианный CPM по всем adsets.
    Используется для diagnostics component.
    """
    cpms = [
        a.get('cpm') for a in adsets_data
        if a.get('cpm') is not None and a.get('cpm') > 0
    ]
    if not cpms:
        return None
    return statistics.median(cpms)


def get_hs_distribution(adsets: List[AdsetHS]) -> Dict[str, int]:
    """
    Считает распределение adsets по классам HS.

    Returns:
        Dict с количеством adsets в каждом классе
    """
    distribution = {
        "very_good": 0,
        "good": 0,
        "neutral": 0,
        "slightly_bad": 0,
        "bad": 0
    }

    for adset in adsets:
        distribution[adset.hs_class.value] += 1

    return distribution


def to_dict(adset_hs: AdsetHS) -> Dict[str, Any]:
    """
    Конвертирует AdsetHS в словарь для YAML вывода.
    """
    return {
        "id": adset_hs.adset_id,
        "name": adset_hs.adset_name,
        "direction": adset_hs.direction,
        "hs": adset_hs.hs,
        "hs_class": adset_hs.hs_class.value,
        "components": {
            "cpl_gap": adset_hs.components.cpl_gap,
            "trends": adset_hs.components.trends,
            "diagnostics": adset_hs.components.diagnostics,
            "today_adj": adset_hs.components.today_adj,
            "volume_factor": adset_hs.components.volume_factor
        },
        "budget": adset_hs.budget,
        "cpl_yesterday": adset_hs.cpl_yesterday,
        "cpl_today": adset_hs.cpl_today,
        "target_cpl": adset_hs.target_cpl,
        "cpl_diff_pct": adset_hs.cpl_diff_pct,
        "impressions_today": adset_hs.impressions_today,
        "is_new": adset_hs.history_flags.is_new,
        "history_flags": {
            "was_decreased_yesterday": adset_hs.history_flags.was_decreased_yesterday,
            "was_increased_yesterday": adset_hs.history_flags.was_increased_yesterday,
            "consecutive_decreases": adset_hs.history_flags.consecutive_decreases
        }
    }


# === Unit Tests ===

if __name__ == "__main__":
    import json

    print("=== Health Scorer Unit Tests ===\n")

    # Test 1: CPL Gap
    print("Test 1: CPL Gap")
    assert calculate_cpl_gap(2.0, 4.0) == 45  # ratio 0.5 → max bonus
    assert abs(calculate_cpl_gap(4.0, 4.0)) < 0.01  # ratio 1.0 → neutral (float precision)
    assert abs(calculate_cpl_gap(6.0, 4.0) - (-30)) < 0.1  # ratio 1.5 → -30
    assert calculate_cpl_gap(8.0, 4.0) == -45  # ratio 2.0 → max penalty
    print("✓ CPL Gap tests passed\n")

    # Test 2: Trends
    print("Test 2: Trends")
    assert calculate_trends(3.0, 4.0) == 15  # -25% improvement → capped at +15
    assert calculate_trends(4.0, 4.0) == 0  # no change
    assert calculate_trends(5.0, 4.0) == -15  # +25% worse → capped at -15
    print("✓ Trends tests passed\n")

    # Test 3: Diagnostics
    print("Test 3: Diagnostics")
    assert calculate_diagnostics(0.5, None, None, None) == -8  # low CTR
    assert calculate_diagnostics(2.0, 15.0, None, 10.0) == -12  # high CPM
    assert calculate_diagnostics(2.0, 8.0, 2.5, 10.0) == -10  # high frequency
    assert calculate_diagnostics(0.5, 15.0, 2.5, 10.0) == -30  # all penalties
    print("✓ Diagnostics tests passed\n")

    # Test 4: Today Adjustment
    print("Test 4: Today Adjustment")
    assert calculate_today_adjustment(3.0, 4.0, 1000) == 25  # 25% improvement
    assert calculate_today_adjustment(4.0, 4.0, 1000) == 0  # no improvement
    assert calculate_today_adjustment(5.0, 4.0, 1000) == 0  # worse today
    assert calculate_today_adjustment(3.0, 4.0, 100) == 0  # not enough impressions
    print("✓ Today Adjustment tests passed\n")

    # Test 5: Volume Factor
    print("Test 5: Volume Factor")
    assert calculate_volume_factor(100) == 0.6
    assert calculate_volume_factor(750) == 0.7
    assert calculate_volume_factor(1500) == 0.8
    assert calculate_volume_factor(3000) == 0.9
    assert calculate_volume_factor(10000) == 1.0
    print("✓ Volume Factor tests passed\n")

    # Test 6: Full HS Calculation
    print("Test 6: Full Health Score")
    result = calculate_health_score(
        adset_id="123456",
        adset_name="Test Adset",
        direction="Имплантация",
        target_cpl=4.0,
        budget=50.0,
        cpl_yesterday=2.5,  # Good CPL
        cpl_today=2.3,
        cpl_3d=2.6,
        cpl_7d=3.0,
        ctr=1.5,
        cpm=8.0,
        frequency=1.5,
        impressions_today=3000,
        median_cpm=10.0
    )

    print(f"  HS: {result.hs}")
    print(f"  Class: {result.hs_class.value}")
    print(f"  Components: {result.components}")
    assert result.hs > 0, "Expected positive HS for good performer"
    assert result.hs_class in [HSClass.VERY_GOOD, HSClass.GOOD]
    print("✓ Full HS test passed\n")

    # Test 7: Classification
    print("Test 7: HS Classification")
    assert classify_hs(30) == HSClass.VERY_GOOD
    assert classify_hs(15) == HSClass.GOOD
    assert classify_hs(0) == HSClass.NEUTRAL
    assert classify_hs(-15) == HSClass.SLIGHTLY_BAD
    assert classify_hs(-30) == HSClass.BAD
    print("✓ Classification tests passed\n")

    # Test 8: YAML output
    print("Test 8: YAML Output")
    output = to_dict(result)
    print(json.dumps(output, indent=2, ensure_ascii=False))
    assert "hs" in output
    assert "components" in output
    assert "history_flags" in output
    print("✓ YAML output test passed\n")

    print("=== All tests passed! ===")
