# Workbench connector marks

Reviewed on 2026-09-27. Brand images are bundled as data URLs; the catalog never
fetches remote images. Preserve the original colors and aspect ratios. The
neutral white plate keeps dark marks legible in both workbench themes.

## Wikimedia Commons

These originals are included without modification:

| Asset | Source and author | License recorded on Commons |
| --- | --- | --- |
| `freecad.svg` | [FreeCAD-logo.svg](https://commons.wikimedia.org/wiki/File:FreeCAD-logo.svg), Yorik van Havre, sourced from the FreeCAD wiki | [LGPL 2.1 or later](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html) |
| `kicad.svg` | [KiCad logo square.svg](https://commons.wikimedia.org/wiki/File:KiCad_logo_square.svg), KiCad Developers Team | [GPL 3 or later](https://www.gnu.org/licenses/gpl-3.0.html) |
| `simulink.png` | [Simulink Logo (non-wordmark).png](https://commons.wikimedia.org/wiki/File:Simulink_Logo_(non-wordmark).png), MathWorks, sourced from its brand guide | PD-textlogo; trademark retained |

The SVG files retain their embedded metadata. Applicable license texts are in
[licenses](../../../licenses/). These marks identify associated products, not vendor endorsement
of community MCP connectors.

## Official-source fallbacks

The workbench also imports the existing official-source assets directly from
[Point official-source records](OFFICIAL-SOURCES.md):
Ansys, Carbon, COMSOL, FMI, Foxglove, HighByte, MATLAB, Nominal, OPC Foundation,
OpenBOM, and PyVISA. That directory records each vendor/project URL. No matching,
verified Commons mark was found for the smaller projects in this review.

- Ansys uses the current vendor's compact A mark. The Commons
  [2019 wordmark](https://commons.wikimedia.org/wiki/File:Ansys_logo_(2019).svg)
  is a full horizontal logo rather than a compact application icon.
- COMSOL uses its official site icon. The Commons
  [wordmark](https://commons.wikimedia.org/wiki/File:Comsol_logo.svg) is sourced
  through a third-party vector site and is too wide for the icon slot.
- MATLAB uses the MathWorks official favicon. Commons
  [Matlab Logo.png](https://commons.wikimedia.org/wiki/File:Matlab_Logo.png)
  explicitly describes a similar, non-identical user-created plot; do not use
  it as an official logo. Simulink has its own mark rather than MATLAB's.
- FMU Runtime uses the FMI format mark; it is a Point adapter, not an FMI product.

`microsoft-365.png` is the existing workbench asset and is outside this engineering
catalog update. The older local `ansys.png` and `matlab.png` are no longer imported.

## Research & experiments

All eight research entries reuse the bundled official-source icons from the
browser catalog. The following source URLs were checked on 2026-09-27:

| Provider | Asset | Official source |
| --- | --- | --- |
| Benchling | `benchling.png` | [Benchling icon](https://www.benchling.com/icon.svg) |
| BioContextAI | `biocontext.png` | [BioContextAI favicon](https://biocontext.ai/favicon-96x96.png) |
| BioMCP | `biomcp.png` | [GenomOncology mark](https://genomoncology.com/wp-content/uploads/2025/11/GenomOncology-logo-mark-digital.svg); [BioMCP identifies its maintainer](https://biomcp.org/) |
| eLabFTW | `elabftw.png` | [eLabFTW touch icon](https://www.elabftw.net/img/apple-touch-icon.png) |
| LabKey | `labkey.png` | [LabKey icon](https://www.labkey.com/wp-content/uploads/2022/06/LK-icon.png) |
| Open Targets | `open-targets.png` | [Open Targets Platform favicon](https://platform.opentargets.org/favicon.png) |
| PyLabRobot | `pylabrobot.png` | [Official project organization avatar](https://github.com/PyLabRobot) |
| Seqera | `seqera.png` | [Seqera favicon](https://seqera.io/images/favicon--dynamic.svg) |

Wikimedia Commons was searched for all eight providers. Its
[eLabFTW logo](https://commons.wikimedia.org/wiki/File:ElabFTW-logo.png) and
[Seqera Labs logo](https://commons.wikimedia.org/wiki/File:Seqera_labs_logo.png)
are horizontal wordmarks; the official compact icons above fit the existing
22px image slot without cropping the brand. No suitable verified Commons mark
was found for the other six providers. BioMCP uses the maintainer's mark, not a
claim of a separate BioMCP product logo. Original colors and proportions are
preserved on the same neutral plate used by the engineering icons.

Scite, Synapse, Zotero, Onshape, Quilt, Wiley Scholar Gateway, and BioRender use bundled vendor icons from `browser/src/mcp-settings/logos/`. Exact original asset URLs and community-connector attribution are recorded in that directory’s `SOURCES.md`.

The Wolfram, W&B, MLflow, Galaxy, Jupyter, R and Autodesk Fusion cards also
reuse the bundled PNGs from `browser/src/mcp-settings/logos`. See its
`SOURCES.md` for Wikimedia/vendor links, authors, licenses and transformations.

Public-data cards that previously used the document placeholder (arXiv, BrAPI,
CDC, ChEMBL, ClinicalTrials.gov, Crossref, DataCite, Ensembl, FAOSTAT, GBIF,
NOAA, NWS, Open-Meteo, OpenAlex, Open Charge Map, openFDA, ORCID, Paleobiology
Database, PubChem, PubMed, UniProt) use the 96 × 96 marks added there on
2026-10-19. Source URLs are in that file.
