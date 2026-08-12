from collections import Counter

from research.top10 import ScoredCompany, select_top10


def scored(symbol, score, sector="Banks", owned=False):
    return ScoredCompany(symbol=symbol, name=symbol, sector=sector, total_score=score, owned=owned, eligible=True, reasons=("evidence",))


def test_top10_caps_each_sector_at_two_and_labels_holdings():
    chosen = select_top10([
        scored("1303", 95, "Industrials", True), scored("2001", 90, "Industrials"), scored("2002", 89, "Industrials"),
        scored("1150", 88, "Banks"), scored("1180", 87, "Banks"), scored("1182", 86, "Banks"),
    ], incumbents=[], owned={"1303"})
    assert max(Counter(item.sector for item in chosen).values()) <= 2
    assert next(item for item in chosen if item.symbol == "1303").owned is True


def test_challenger_needs_five_point_buffer_to_replace_eligible_incumbent():
    incumbent = scored("1150", 80.0)
    challenger = scored("1180", 84.9)
    chosen = select_top10([incumbent, challenger], [incumbent], set())
    assert chosen[0].symbol == "1150"
