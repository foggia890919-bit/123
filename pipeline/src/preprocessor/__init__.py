from .footer_parser import FooterMetadata, parse_footer_text, merge_into_fields
from .orientation import auto_orient, estimate_rotation_degrees, rotate_clockwise
from .pipeline import preprocess, PreprocessResult, PreprocessOptions
from .source_kind import SourceKindResult, detect_source_kind

__all__ = [
    "preprocess",
    "PreprocessResult",
    "PreprocessOptions",
    "FooterMetadata",
    "parse_footer_text",
    "merge_into_fields",
    "SourceKindResult",
    "detect_source_kind",
    "auto_orient",
    "estimate_rotation_degrees",
    "rotate_clockwise",
]
