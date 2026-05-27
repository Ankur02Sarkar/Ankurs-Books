#!/usr/bin/env python3
"""
Sacred-Texts Book Scraper
A scalable, robust scraper for books on sacred-texts.com, designed with Cloudflare
bypass capabilities, auto-retry logic, and heuristic-based paragraph detection.
"""

import argparse
import json
import logging
import time
import urllib.parse
from typing import Any, Dict, List, Optional
from bs4 import BeautifulSoup
from curl_cffi import requests
from rich.console import Console
from rich.logging import RichHandler
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, MofNCompleteColumn, TimeRemainingColumn

# Set up logging with Rich
logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    datefmt="[%X]",
    handlers=[RichHandler(rich_tracebacks=True)]
)
logger = logging.getLogger("scraper")
console = Console()

class SacredTextsScraper:
    def __init__(
        self,
        index_url: str,
        output_file: str,
        limit_hymns: Optional[int] = None,
        delay: float = 1.0,
        max_retries: int = 3,
        book_selector: str = "body > a[href]",
        hymn_selector: str = "body > a[href]",
        hymn_content_selector: str = "body > p",
        hymn_p_index: Optional[int] = None,
        verbose: bool = False
    ):
        self.index_url = index_url
        self.output_file = output_file
        self.limit_hymns = limit_hymns
        self.delay = delay
        self.max_retries = max_retries
        self.book_selector = book_selector
        self.hymn_selector = hymn_selector
        self.hymn_content_selector = hymn_content_selector
        self.hymn_p_index = hymn_p_index
        
        if verbose:
            logger.setLevel(logging.DEBUG)
            
        # Extract base folder URL for relative URL resolution
        # e.g., https://sacred-texts.com/hin/rigveda/index.htm -> https://sacred-texts.com/hin/rigveda/
        parsed_url = urllib.parse.urlparse(self.index_url)
        self.base_url = f"{parsed_url.scheme}://{parsed_url.netloc}{parsed_url.path.rsplit('/', 1)[0]}/"
        
    def _fetch_html(self, url: str) -> Optional[str]:
        """Fetch HTML content using curl_cffi to bypass Cloudflare."""
        retries = 0
        backoff = 2.0
        
        while retries <= self.max_retries:
            try:
                logger.debug(f"Fetching URL: {url}")
                # Impersonate chrome to bypass TLS fingerprinting and Cloudflare checks
                response = requests.get(
                    url, 
                    impersonate="chrome", 
                    timeout=30,
                    allow_redirects=True
                )
                
                if response.status_code == 200:
                    # Enforce politeness delay after a successful fetch
                    if self.delay > 0:
                        time.sleep(self.delay)
                    return response.text
                
                logger.warning(
                    f"Non-200 status code {response.status_code} for {url}. "
                    f"Retrying in {backoff}s... (Attempt {retries + 1}/{self.max_retries})"
                )
                
            except Exception as e:
                logger.warning(
                    f"Error fetching {url}: {e}. "
                    f"Retrying in {backoff}s... (Attempt {retries + 1}/{self.max_retries})"
                )
            
            time.sleep(backoff)
            retries += 1
            backoff *= 2.0  # Exponential backoff
            
        logger.error(f"Failed to fetch {url} after {self.max_retries} attempts.")
        return None

    def _extract_text_heuristic(self, p_tags: List[BeautifulSoup]) -> str:
        """
        Extract the actual hymn content from paragraph tags using heuristics.
        This filters out copyright headers, metadata, and navigation footers.
        """
        best_p = None
        best_score = -9999.0
        
        for i, p in enumerate(p_tags):
            text = p.get_text().strip()
            if not text:
                continue
                
            # Compute link density
            links = p.find_all("a")
            text_len = len(text)
            link_density = len(links) / text_len if text_len > 0 else 0
            
            # Penalize navigation/link heavy paragraphs
            score = -100.0 * link_density
            
            # Penalize short paragraphs (likely headers/footers)
            if text_len < 50:
                score -= 10.0
            else:
                score += min(text_len / 100.0, 15.0)  # Reward substantial text paragraphs
                
            # Check for navigation or metadata keywords
            keywords = ["next:", "previous:", "index", "sacred texts", "sacred-texts", "buy this book", "translated by", "tr. by"]
            lower_text = text.lower()
            keyword_count = sum(1 for kw in keywords if kw in lower_text)
            
            # Penalize heavily if navigation keywords are found
            if keyword_count > 0:
                score -= 50.0 * keyword_count
                
            # Check for verse-like patterns (starts with numbers)
            words = text.split()
            if words and words[0].isdigit():
                score += 20.0
                
            logger.debug(f"Paragraph P[{i}] length: {text_len}, link density: {link_density:.3f}, score: {score:.1f}, snippet: {text[:60]}...")
            
            if score > best_score:
                best_score = score
                best_p = p
                
        if best_p:
            # We want to format the paragraphs nicely, preserving line breaks inside the paragraph.
            # Convert <br> or <br/> tags to actual newlines.
            for br in best_p.find_all("br"):
                br.replace_with("\n")
            return best_p.get_text().strip()
            
        return ""

    def scrape(self) -> Dict[str, Any]:
        """Main scraping controller."""
        logger.info(f"Starting scrape from index: {self.index_url}")
        
        # 1. Fetch index page
        index_html = self._fetch_html(self.index_url)
        if not index_html:
            raise RuntimeError("Could not retrieve book index page.")
            
        soup = BeautifulSoup(index_html, "html.parser")
        
        # Determine book title
        title_element = soup.find("title")
        book_title = title_element.get_text().strip() if title_element else "Sacred Texts Book"
        logger.info(f"Book Title: {book_title}")
        
        # 2. Extract books/mandalas
        book_elements = soup.select(self.book_selector)
        books_to_scrape = []
        
        for elem in book_elements:
            href = elem.get("href")
            if not href:
                continue
            
            # Form absolute URL
            absolute_book_url = urllib.parse.urljoin(self.index_url, href)
            # Filter URLs to make sure they are sub-pages of the book directory
            if absolute_book_url.startswith(self.base_url) and absolute_book_url != self.index_url:
                books_to_scrape.append({
                    "title": elem.get_text().strip(),
                    "url": absolute_book_url
                })
                
        # Handle duplicates and filter out external index pages
        seen_urls = set()
        unique_books = []
        for b in books_to_scrape:
            # Avoid re-adding the index itself and keep unique ones
            if b["url"] not in seen_urls and "errata.htm" not in b["url"]:
                unique_books.append(b)
                seen_urls.add(b["url"])
                
        logger.info(f"Found {len(unique_books)} sub-books/mandalas to process.")
        
        scraped_data = {
            "book_title": book_title,
            "index_url": self.index_url,
            "books": []
        }
        
        hymns_scraped_count = 0
        limit_reached = False
        
        # 3. For each book, fetch hymns
        for idx, book in enumerate(unique_books):
            if limit_reached:
                break
                
            logger.info(f"[{idx+1}/{len(unique_books)}] Scraping book: '{book['title']}'")
            book_html = self._fetch_html(book["url"])
            if not book_html:
                logger.warning(f"Skipping book due to fetch error: {book['url']}")
                continue
                
            book_soup = BeautifulSoup(book_html, "html.parser")
            hymn_elements = book_soup.select(self.hymn_selector)
            
            hymns_in_book = []
            for elem in hymn_elements:
                href = elem.get("href")
                if not href:
                    continue
                
                # Filter out standard non-hymn navigation links inside pages (e.g. index.htm, next, prev)
                # Hymn links are usually direct file references like rv01001.htm
                # Keep them if they start with letters and match typical patterns
                if "index.htm" in href or "errata.htm" in href or "../" in href:
                    continue
                    
                absolute_hymn_url = urllib.parse.urljoin(book["url"], href)
                if absolute_hymn_url.startswith(self.base_url):
                    hymns_in_book.append({
                        "title": elem.get_text().strip(),
                        "url": absolute_hymn_url
                    })
            
            # Unique hymn links
            seen_hymns = set()
            unique_hymns = []
            for h in hymns_in_book:
                if h["url"] not in seen_hymns:
                    unique_hymns.append(h)
                    seen_hymns.add(h["url"])
            
            logger.info(f"Found {len(unique_hymns)} hymns in '{book['title']}'")
            
            scraped_hymns = []
            
            # Progress bar for hymns in this book
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                BarColumn(),
                MofNCompleteColumn(),
                TimeRemainingColumn(),
                console=console
            ) as progress:
                task = progress.add_task(f"Scraping '{book['title']}'", total=len(unique_hymns))
                
                for hymn in unique_hymns:
                    if self.limit_hymns is not None and hymns_scraped_count >= self.limit_hymns:
                        logger.info(f"Reached output limit of {self.limit_hymns} hymns. Stopping.")
                        limit_reached = True
                        break
                        
                    # Fetch hymn content page
                    hymn_html = self._fetch_html(hymn["url"])
                    if not hymn_html:
                        logger.warning(f"Could not fetch hymn page: {hymn['url']}")
                        progress.advance(task)
                        continue
                        
                    hymn_soup = BeautifulSoup(hymn_html, "html.parser")
                    p_tags = hymn_soup.select(self.hymn_content_selector)
                    
                    content = ""
                    if self.hymn_p_index is not None:
                        # Extract by explicit index if provided and safe
                        if 0 <= self.hymn_p_index < len(p_tags):
                            # Convert breaks to newlines before getting text
                            target_p = p_tags[self.hymn_p_index]
                            for br in target_p.find_all("br"):
                                br.replace_with("\n")
                            content = target_p.get_text().strip()
                        else:
                            logger.debug(f"Requested index {self.hymn_p_index} out of bounds ({len(p_tags)} elements). Using heuristic.")
                            content = self._extract_text_heuristic(p_tags)
                    else:
                        # Auto-extract using heuristic selector
                        content = self._extract_text_heuristic(p_tags)
                        
                    scraped_hymns.append({
                        "title": hymn["title"],
                        "url": hymn["url"],
                        "content": content
                    })
                    
                    hymns_scraped_count += 1
                    progress.advance(task)
                    
            scraped_data["books"].append({
                "title": book["title"],
                "url": book["url"],
                "hymns": scraped_hymns
            })
            
        # 4. Save to JSON
        logger.info(f"Scrape completed! Total hymns scraped: {hymns_scraped_count}")
        logger.info(f"Saving data to {self.output_file}")
        with open(self.output_file, "w", encoding="utf-8") as f:
            json.dump(scraped_data, f, ensure_ascii=False, indent=2)
        logger.info("Save successful.")
        return scraped_data

def main():
    parser = argparse.ArgumentParser(
        description="Scalable scraper for books on sacred-texts.com."
    )
    parser.add_argument(
        "--index-url",
        default="https://sacred-texts.com/hin/rigveda/index.htm",
        help="The index URL of the sacred-texts book to scrape (default: Rigveda index)"
    )
    parser.add_argument(
        "--output-file",
        default="rigveda.json",
        help="JSON file path to save scraped data (default: rigveda.json)"
    )
    parser.add_argument(
        "--limit-hymns",
        type=int,
        default=None,
        help="Optional integer to limit the total number of hymns to scrape (for testing/dry-runs)"
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="Politeness delay in seconds between requests (default: 1.0)"
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=3,
        help="Maximum retries for failed HTTP requests (default: 3)"
    )
    parser.add_argument(
        "--book-selector",
        default="body > a[href]",
        help="CSS selector to locate sub-book/mandala links on the index page"
    )
    parser.add_argument(
        "--hymn-selector",
        default="body > a[href]",
        help="CSS selector to locate hymn links on each sub-book/mandala page"
    )
    parser.add_argument(
        "--hymn-content-selector",
        default="body > p",
        help="CSS selector for paragraph tags on a hymn page"
    )
    parser.add_argument(
        "--hymn-p-index",
        type=int,
        default=None,
        help="Explicit index (0-based) for the content paragraph. If omitted, heuristic auto-detection is used."
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose DEBUG logs"
    )
    
    args = parser.parse_args()
    
    try:
        scraper = SacredTextsScraper(
            index_url=args.index_url,
            output_file=args.output_file,
            limit_hymns=args.limit_hymns,
            delay=args.delay,
            max_retries=args.max_retries,
            book_selector=args.book_selector,
            hymn_selector=args.hymn_selector,
            hymn_content_selector=args.hymn_content_selector,
            hymn_p_index=args.hymn_p_index,
            verbose=args.verbose
        )
        scraper.scrape()
    except Exception as e:
        logger.exception(f"Scraper execution failed: {e}")
        exit(1)

if __name__ == "__main__":
    main()
