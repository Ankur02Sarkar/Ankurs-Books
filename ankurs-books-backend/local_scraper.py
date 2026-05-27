#!/usr/bin/env python3
"""
Sacred-Texts Local Scraper (using Scrapling)
Fetches books and hymns locally to bypass Cloudflare blocks and generates 
a scraped_raw_hymns.json file to be uploaded to Google Colab for translation.
"""

import argparse
import json
import logging
import time
import urllib.parse
import threading
import re
from typing import Any, Dict, List, Optional
from bs4 import BeautifulSoup
from scrapling.fetchers import Fetcher
from concurrent.futures import ThreadPoolExecutor, as_completed
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
logger = logging.getLogger("local_scraper")
console = Console()

class LocalSacredTextsScraper:
    def __init__(
        self,
        index_url: str,
        output_file: str,
        limit_hymns: Optional[int] = None,
        delay: float = 5.0,
        max_workers: int = 5,
        book_selector: str = "a[href]",
        hymn_selector: str = "a[href]",
        hymn_content_selector: str = "body > p",
        hymn_p_index: Optional[int] = None,
        verbose: bool = False
    ):
        self.index_url = index_url
        self.output_file = output_file
        self.limit_hymns = limit_hymns
        self.delay = delay
        self.max_workers = max_workers
        self.book_selector = book_selector
        self.hymn_selector = hymn_selector
        self.hymn_content_selector = hymn_content_selector
        self.hymn_p_index = hymn_p_index
        self.lock = threading.Lock()
        self.last_request_time = 0.0
        
        if verbose:
            logger.setLevel(logging.DEBUG)
            
        parsed_url = urllib.parse.urlparse(self.index_url)
        self.base_url = f"{parsed_url.scheme}://{parsed_url.netloc}{parsed_url.path.rsplit('/', 1)[0]}/"
        
    def _fetch_html(self, url: str) -> Optional[str]:
        """Fetch HTML content using scrapling Fetcher to bypass Cloudflare Turnstile with paced rate-limiting."""
        retries = 0
        backoff = 5.0
        max_retries = 3
        
        while retries <= max_retries:
            try:
                # Paced rate-limiting block
                if self.delay > 0:
                    with self.lock:
                        now = time.time()
                        elapsed = now - self.last_request_time
                        if elapsed < self.delay:
                            time.sleep(self.delay - elapsed)
                        self.last_request_time = time.time()
                        
                        logger.debug(f"Fetching URL: {url}")
                        page = Fetcher.get(url, timeout=30)
                else:
                    logger.debug(f"Fetching URL: {url}")
                    page = Fetcher.get(url, timeout=30)

                if page.status == 200:
                    return page.html_content
                
                logger.warning(
                    f"Non-200 status code {page.status} for {url}. "
                    f"Retrying in {backoff}s... (Attempt {retries + 1}/{max_retries})"
                )
            except Exception as e:
                logger.warning(
                    f"Error fetching {url}: {e}. "
                    f"Retrying in {backoff}s... (Attempt {retries + 1}/{max_retries})"
                )
            
            time.sleep(backoff)
            retries += 1
            backoff *= 2.0
            
        logger.error(f"Failed to fetch {url} after {max_retries} attempts.")
        return None

    def _extract_text_heuristic(self, p_tags: List[BeautifulSoup]) -> str:
        """Extract the actual hymn content from paragraph tags using heuristics."""
        best_p = None
        best_score = -9999.0
        
        for i, p in enumerate(p_tags):
            text = p.get_text().strip()
            if not text:
                continue
                
            links = p.find_all("a")
            text_len = len(text)
            link_density = len(links) / text_len if text_len > 0 else 0
            
            score = -100.0 * link_density
            
            if text_len < 50:
                score -= 10.0
            else:
                score += min(text_len / 100.0, 15.0)
                
            keywords = ["next:", "previous:", "index", "sacred texts", "sacred-texts", "buy this book", "translated by", "tr. by"]
            lower_text = text.lower()
            keyword_count = sum(1 for kw in keywords if kw in lower_text)
            
            if keyword_count > 0:
                score -= 50.0 * keyword_count
                
            words = text.split()
            if words and words[0].isdigit():
                score += 20.0
                
            logger.debug(f"Paragraph P[{i}] length: {text_len}, link density: {link_density:.3f}, score: {score:.1f}, snippet: {text[:60]}...")
            
            if score > best_score:
                best_score = score
                best_p = p
                
        if best_p:
            for br in best_p.find_all("br"):
                br.replace_with("\n")
            return best_p.get_text().strip()
            
        return ""

    def scrape_hymn_content(self, hymn_url: str) -> str:
        """Fetch a single hymn content and extract the verses."""
        html = self._fetch_html(hymn_url)
        if not html:
            return ""
        soup = BeautifulSoup(html, "html.parser")
        p_tags = soup.select(self.hymn_content_selector)
        
        if self.hymn_p_index is not None and 0 <= self.hymn_p_index < len(p_tags):
            target_p = p_tags[self.hymn_p_index]
            for br in target_p.find_all("br"):
                br.replace_with("\n")
            return target_p.get_text().strip()
            
        return self._extract_text_heuristic(p_tags)

    def scrape_hymns_parallel(self, hymns_list: List[Dict[str, str]], progress_bar, task_id) -> List[Dict[str, Any]]:
        """Scrapes multiple hymns concurrently, preserving order."""
        results = [None] * len(hymns_list)
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            future_to_index = {
                executor.submit(self.scrape_hymn_content, hymn["url"]): idx
                for idx, hymn in enumerate(hymns_list)
            }
            for future in as_completed(future_to_index):
                idx = future_to_index[future]
                hymn = hymns_list[idx]
                try:
                    content = future.result()
                    results[idx] = {
                        "title": hymn["title"],
                        "url": hymn["url"],
                        "content": content
                    }
                except Exception as e:
                    logger.error(f"Error scraping {hymn['title']}: {e}")
                    results[idx] = {
                        "title": hymn["title"],
                        "url": hymn["url"],
                        "content": ""
                    }
                progress_bar.advance(task_id)
        return [r for r in results if r is not None]

    def scrape(self) -> Dict[str, Any]:
        """Main scraping controller."""
        logger.info(f"Starting local scrape from index: {self.index_url}")
        
        index_html = self._fetch_html(self.index_url)
        if not index_html:
            raise RuntimeError("Could not retrieve book index page.")
            
        soup = BeautifulSoup(index_html, "html.parser")
        title_element = soup.find("title")
        book_title = title_element.get_text().strip() if title_element else "Sacred Texts Book"
        logger.info(f"Book Title: {book_title}")
        
        book_elements = soup.select(self.book_selector)
        books_to_scrape = []
        for elem in book_elements:
            href = elem.get("href")
            if not href or not href.startswith("rvi"):
                continue
            absolute_book_url = urllib.parse.urljoin(self.index_url, href)
            if absolute_book_url.startswith(self.base_url) and absolute_book_url != self.index_url:
                books_to_scrape.append({
                    "title": elem.get_text().strip(),
                    "url": absolute_book_url
                })
                
        seen_urls = set()
        unique_books = []
        for b in books_to_scrape:
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
        
        # Outer progress for books, inner for hymns
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
            
            # Extract book number from filename (e.g. "02" from "rvi02.htm") to match book-specific hymns
            book_filename = book["url"].split('/')[-1]
            book_num_match = re.search(r"rvi(\d+)\.htm", book_filename)
            expected_prefix = f"rv{book_num_match.group(1)}" if book_num_match else "rv"
            
            hymns_in_book = []
            for elem in hymn_elements:
                href = elem.get("href")
                if not href:
                    continue
                clean_href = href.split('/')[-1]
                if clean_href.startswith(expected_prefix):
                    absolute_hymn_url = urllib.parse.urljoin(book["url"], href)
                    if absolute_hymn_url.startswith(self.base_url):
                        hymns_in_book.append({
                            "title": elem.get_text().strip(),
                            "url": absolute_hymn_url
                        })
            
            seen_hymns = set()
            unique_hymns = []
            for h in hymns_in_book:
                if h["url"] not in seen_hymns:
                    unique_hymns.append(h)
                    seen_hymns.add(h["url"])
            
            # Apply limit if requested
            if self.limit_hymns is not None:
                remaining_limit = self.limit_hymns - hymns_scraped_count
                if remaining_limit <= 0:
                    limit_reached = True
                    break
                unique_hymns = unique_hymns[:remaining_limit]
            
            logger.info(f"Scraping {len(unique_hymns)} hymns in '{book['title']}'...")
            
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                BarColumn(),
                MofNCompleteColumn(),
                TimeRemainingColumn(),
                console=console
            ) as progress:
                task = progress.add_task(f"Downloading hymns", total=len(unique_hymns))
                scraped_hymns = self.scrape_hymns_parallel(unique_hymns, progress, task)
                
            hymns_scraped_count += len(scraped_hymns)
            
            scraped_data["books"].append({
                "title": book["title"],
                "url": book["url"],
                "hymns": scraped_hymns
            })
            
            if self.limit_hymns is not None and hymns_scraped_count >= self.limit_hymns:
                logger.info(f"Reached output limit of {self.limit_hymns} hymns. Stopping.")
                limit_reached = True
                break
                
        logger.info(f"Local scrape completed! Total hymns scraped: {hymns_scraped_count}")
        logger.info(f"Saving raw data to {self.output_file}")
        with open(self.output_file, "w", encoding="utf-8") as f:
            json.dump(scraped_data, f, ensure_ascii=False, indent=2)
        logger.info("Save successful. Ready for upload to Google Colab!")
        return scraped_data

def main():
    parser = argparse.ArgumentParser(
        description="Local scraper using Scrapling to bypass Cloudflare."
    )
    parser.add_argument(
        "--index-url",
        default="https://sacred-texts.com/hin/rigveda/index.htm",
        help="The index URL of the sacred-texts book to scrape"
    )
    parser.add_argument(
        "--output-file",
        default="scraped_raw_hymns.json",
        help="JSON file path to save raw scraped data (default: scraped_raw_hymns.json)"
    )
    parser.add_argument(
        "--limit-hymns",
        type=int,
        default=None,
        help="Optional limit to the total number of hymns to scrape (for testing/dry-runs)"
    )
    parser.add_argument(
        "--max-workers",
        type=int,
        default=1,
        help="Maximum concurrent workers for scraping. Set to 1 for safe sequential pacing (default: 1)"
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=5.0,
        help="Delay in seconds between consecutive requests to prevent rate limiting (default: 5.0)"
    )
    parser.add_argument(
        "--hymn-p-index",
        type=int,
        default=None,
        help="Explicit index (0-based) for the content paragraph. Default uses heuristic auto-detection."
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose DEBUG logs"
    )
    
    args = parser.parse_args()
    
    try:
        scraper = LocalSacredTextsScraper(
            index_url=args.index_url,
            output_file=args.output_file,
            limit_hymns=args.limit_hymns,
            delay=args.delay,
            max_workers=args.max_workers,
            hymn_p_index=args.hymn_p_index,
            verbose=args.verbose
        )
        scraper.scrape()
    except Exception as e:
        logger.exception(f"Scraper execution failed: {e}")
        exit(1)

if __name__ == "__main__":
    main()
