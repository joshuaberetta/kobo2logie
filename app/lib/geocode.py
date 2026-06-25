"""
Geocoding via geocoder.imtools.info.
Port of src/lib/geocode.ts.
"""

import logging

import httpx

logger = logging.getLogger(__name__)

GEOCODER_URL = 'https://geocoder.imtools.info/geocode'
HEADERS = {'User-Agent': 'kobo2logie/2.0'}


def geocode_submission(lat: float, lon: float) -> dict[str, str]:
    """
    Reverse geocode coordinates → ADM0–ADM4 P-codes and names.
    Returns keys like _adm0_pcode, _adm0_name, etc.
    Returns {} on error or no coverage.
    """
    try:
        resp = httpx.get(
            GEOCODER_URL,
            params={'lat': str(lat), 'lon': str(lon)},
            headers=HEADERS,
            timeout=10,
        )
        if resp.status_code == 404:
            logger.info('[geo] No coverage at (%s, %s)', lat, lon)
            return {}
        if not resp.is_success:
            logger.error('[geo] HTTP %s from geocoder', resp.status_code)
            return {}
        data = resp.json()
    except Exception as exc:
        logger.error('[geo] fetch error: %s', exc)
        return {}

    if not data.get('success'):
        logger.info('[geo] success=false: %s', data.get('error'))
        return {}

    out: dict[str, str] = {}
    for n in range(5):
        pcode = data.get(f'adm{n}_pcode')
        name = data.get(f'adm{n}_name')
        if isinstance(pcode, str) and pcode:
            out[f'_adm{n}_pcode'] = pcode
        if isinstance(name, str) and name:
            out[f'_adm{n}_name'] = name
    return out


def geocode_address(address: str) -> dict[str, str]:
    """
    Forward geocode an address string → lat/lon + P-codes.
    Returns keys like _latitude, _longitude, _adm0_pcode, etc.
    Returns {} when the address cannot be resolved or on error.
    """
    try:
        resp = httpx.get(
            GEOCODER_URL,
            params={'address': address},
            headers=HEADERS,
            timeout=10,
        )
        if resp.status_code == 404:
            logger.info('[geo/address] No result for: %s', address)
            return {}
        if not resp.is_success:
            logger.error('[geo/address] HTTP %s from geocoder', resp.status_code)
            return {}
        data = resp.json()
    except Exception as exc:
        logger.error('[geo/address] fetch error: %s', exc)
        return {}

    if not data.get('success'):
        logger.info('[geo/address] success=false: %s', data.get('error'))
        return {}

    out: dict[str, str] = {}
    if isinstance(data.get('latitude'), (int, float)):
        out['_latitude'] = str(data['latitude'])
    if isinstance(data.get('longitude'), (int, float)):
        out['_longitude'] = str(data['longitude'])
    for n in range(5):
        pcode = data.get(f'adm{n}_pcode')
        name = data.get(f'adm{n}_name')
        if isinstance(pcode, str) and pcode:
            out[f'_adm{n}_pcode'] = pcode
        if isinstance(name, str) and name:
            out[f'_adm{n}_name'] = name
    return out
